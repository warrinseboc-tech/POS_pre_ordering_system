import io
import os
import secrets
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from PIL import Image, ImageDraw
from werkzeug.security import generate_password_hash
from istilo import create_app
from istilo.db import connect, execute, transaction
from istilo.setup import initialize


class PortalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder=tempfile.TemporaryDirectory()
        cls.database='istillo_test_'+secrets.token_hex(6)
        cls.app=create_app(dict(TESTING=True,DB_NAME=cls.database,UPLOAD_FOLDER=cls.folder.name))
        with cls.app.app_context():
            initialize(cls.app)
            with transaction():
                for role in ('admin','crew'):
                    execute('INSERT INTO users(id,employee_id,name,email,password_hash,role) VALUES(%s,%s,%s,%s,%s,%s)',(role,role.upper()+'001',role,'',generate_password_hash('Test-Password-2026!'),role))

    @classmethod
    def tearDownClass(cls):
        with cls.app.app_context():
            connection=connect(False); cursor=connection.cursor()
            if not cls.database.startswith('istillo_test_'): raise RuntimeError('Refusing to remove a non-test database')
            cursor.execute('DROP DATABASE `'+cls.database+'`');cursor.close();connection.close()
        cls.folder.cleanup()

    def setUp(self):
        self.customer=self.app.test_client();self.crew=self.app.test_client();self.admin=self.app.test_client()
        # Order scenarios require an existing verified customer, independently of signup.
        email='orders-'+secrets.token_hex(6)+'@example.com'
        with self.app.app_context(), transaction():
            execute('INSERT INTO accounts(password,name,user_email,phone,email_verified) VALUES(%s,%s,%s,%s,1)',
                    (generate_password_hash('Test-Password-2026!'),'Order customer',email,'09171234567'))
        self.assertEqual(self.post(self.customer,'/auth/customer/login',dict(identifier=email,password='Test-Password-2026!')).status_code,200)
        self.login(self.crew,'crew'); self.login(self.admin,'admin')
        self.assertEqual(self.post(self.crew,'/shifts/in',{},'crew').status_code,200)

    def tearDown(self):
        if self.get(self.crew,'crew')['onShift']:
            self.assertEqual(self.post(self.crew,'/shifts/out',{},'crew').status_code,200)

    def get(self,client,portal='customer'):
        response=client.get('/api/state',headers={'X-Portal':portal});self.assertEqual(response.status_code,200);return response.json

    def post(self,client,path,data=None,portal='customer',**kwargs):
        token=self.get(client,portal)['csrf']
        return client.post('/api'+path,json=data,headers={'X-Portal':portal,'X-CSRF-Token':token},**kwargs)

    def login(self,client,role):
        response=self.post(client,'/auth/login',dict(employee=role.upper()+'001',password='Test-Password-2026!',role=role),role)
        self.assertEqual(response.status_code,200)

    def test_customer_order_requires_policy_agreement(self):
        email='policy-'+secrets.token_hex(6)+'@example.com'
        with patch('istilo.email_otp.send_code') as mail:
            registration=self.post(self.customer,'/auth/customer/register',dict(
            name='Policy test',email=email,
            phone='09'+str(secrets.randbelow(10**9)).zfill(9),
            password='Policy-Test-Password-2026!',terms=True))
        self.assertEqual(registration.status_code,201,registration.json)
        self.assertEqual(self.post(self.customer,'/auth/customer/verify-email',dict(code=mail.call_args.args[1])).status_code,200)
        self.assertEqual(self.post(self.customer,'/auth/customer/login',dict(identifier=email,password='Policy-Test-Password-2026!')).status_code,200)
        product=next(product for product in self.get(self.customer)['products'] if product['available'])
        size=product['sizes'][0]
        item=dict(id=product['id'],size=size['name'],flavor=product['flavors'][0],qty=1,
                  price=product['price']+size['extra'])
        data=dict(requestKey='REQ-'+secrets.token_hex(16),source='Customer',payment='GCash',items=[item])
        self.assertEqual(self.post(self.customer,'/orders',data).status_code,400)
        data['termsAccepted']=False
        self.assertEqual(self.post(self.customer,'/orders',data).status_code,400)
        data['termsAccepted']=True
        accepted=self.post(self.customer,'/orders',data)
        self.assertEqual(accepted.status_code,201,accepted.json)

    def test_policy_interfaces_and_legacy_agreement_link(self):
        for path,title in (
            ('/terms-and-conditions','Terms and Conditions'),
            ('/terms-and-conditions/','Terms and Conditions'),
            ('/privacy-policy','Privacy Policy'),
            ('/privacy-policy/','Privacy Policy'),
        ):
            with self.customer.get(path) as response:
                self.assertEqual(response.status_code,200)
                self.assertIn(title.encode(),response.data)
        for path in ('/customer/agreement.html','/customer/customer/agreement.html'):
            response=self.customer.get(path)
            self.assertEqual(response.status_code,302)
            self.assertEqual(response.headers['Location'],'/terms-and-conditions')

    def order(self,method='GCash',source='Customer',client=None,**extra):
        client=client or self.customer;portal='crew' if source=='Counter' else 'customer'
        data=dict(requestKey='REQ-'+secrets.token_hex(16),customer='API test',source=source,payment=method,paid=100,termsAccepted=True,items=[dict(id='C01',size='Ice',flavor='Original',qty=1,price=95)],**extra)
        response=self.post(client,'/orders',data,portal);self.assertEqual(response.status_code,201,response.json);return response.json['order'],data

    def proof(self,order,reference=None,raw=None):
        if raw is None:
            image=Image.new('RGB',(220,280),'white');ImageDraw.Draw(image).text((20,20),secrets.token_hex(12),fill='black');output=io.BytesIO();image.save(output,'PNG');raw=output.getvalue()
        token=self.get(self.customer)['csrf']
        return self.customer.post('/api/orders/'+order['id']+'/proof',data=dict(reference=reference or str(secrets.randbelow(10**13)).zfill(13),amount=str(order['total']),proof=(io.BytesIO(raw),'receipt.png')),headers={'X-Portal':'customer','X-CSRF-Token':token},content_type='multipart/form-data')

    def test_payment_gate_and_manual_punch(self):
        order,data=self.order();id=order['id']
        self.assertIn(id,[o['id'] for o in self.get(self.crew,'crew')['orders']])
        duplicate=self.post(self.customer,'/orders',data);self.assertEqual(duplicate.json['order']['id'],id)
        self.assertEqual(self.proof(order,raw=b'<svg>bad</svg>').status_code,400)
        response=self.proof(order,reference='1234567890123');self.assertEqual(response.status_code,201,response.json);proof_id=response.json['proofId']
        self.assertIn(id,[o['id'] for o in self.get(self.crew,'crew')['orders']])
        self.assertEqual(self.post(self.crew,'/orders/'+id+'/punch',{},'crew').status_code,404)
        self.assertTrue(self.get(self.crew,'crew')['proofs'])
        self.assertEqual(self.get(self.admin,'admin')['proofs'],[])
        self.assertEqual(self.admin.get('/api/payments/proofs/'+proof_id+'/image').status_code,403)
        self.assertEqual(self.post(self.admin,'/payments/proofs/'+proof_id+'/review',dict(decision='approve'),'admin').status_code,403)
        self.assertEqual(self.app.test_client().get('/api/payments/proofs/'+proof_id+'/image').status_code,404)
        with self.crew.get('/api/payments/proofs/'+proof_id+'/image') as image_response:
            self.assertEqual(image_response.status_code,200)
        review=dict(decision='approve',reference='1234567890123',receivedAmount='95.00',confirmedReceived=False)
        self.assertEqual(self.post(self.crew,'/payments/proofs/'+proof_id+'/review',review,'crew').status_code,400)
        review['confirmedReceived']=True
        self.assertEqual(self.post(self.crew,'/payments/proofs/'+proof_id+'/review',review,'crew').status_code,200)
        queued=next(o for o in self.get(self.crew,'crew')['orders'] if o['id']==id)
        self.assertEqual(queued['paymentStatus'],'Verified');self.assertIsNone(queued['punchedAt'])
        self.assertEqual(self.post(self.crew,'/orders/'+id+'/punch',{},'crew').status_code,200)
        self.assertEqual(self.post(self.crew,'/orders/'+id+'/punch',{},'crew').status_code,409)
        for status in ('Ready','Completed'):
            self.assertEqual(self.post(self.crew,'/orders/'+id+'/status',dict(status=status),'crew').status_code,200)
        self.assertEqual(self.post(self.crew,'/payments/proofs/'+proof_id+'/review',review,'crew').status_code,409)

    def test_cash_permissions_csrf_and_prices(self):
        self.assertEqual(self.customer.post('/api/inquiries',json={}).status_code,403)
        self.assertEqual(self.post(self.customer,'/products',{}).status_code,401)
        self.assertEqual(self.post(self.crew,'/products',{},'crew').status_code,403)
        order,data=self.order('Cash','Counter',self.crew)
        self.assertEqual(order['total'],95);self.assertEqual(order['change'],5);self.assertEqual(order['status'],'Completed')
        data['requestKey']=secrets.token_hex(16);data['items'][0]['price']=1
        self.assertEqual(self.post(self.crew,'/orders',data,'crew').status_code,409)
        other=self.app.test_client()
        self.assertEqual(other.get('/backend/.env').status_code,404)
        self.assertEqual(other.get('/instance/session.key').status_code,404)

    def test_admin_creates_active_crew_account(self):
        employee='CREW_'+secrets.token_hex(5).upper()
        data=dict(name='New crew',employeeId=employee,password='New-Crew-Password!')
        self.assertEqual(self.post(self.crew,'/staff',data,'crew').status_code,403)
        self.assertEqual(self.post(self.admin,'/staff',data,'admin').status_code,201)
        self.assertEqual(self.post(self.admin,'/staff',data,'admin').status_code,409)
        client=self.app.test_client()
        login=self.post(client,'/auth/login',dict(employee=employee,password=data['password'],role='crew'),'crew')
        self.assertEqual(login.status_code,200)
        self.assertTrue(login.json['user']['active'])
        self.assertEqual(login.json['user']['role'],'crew')
        member=next(u for u in self.get(self.admin,'admin')['staff'] if u['employeeId']==employee)
        self.assertEqual(self.post(client,'/staff',data,'crew').status_code,403)
        token=self.get(self.admin,'admin')['csrf']
        response=self.admin.patch('/api/staff/'+member['id'],json=dict(active=False),headers={'X-Portal':'admin','X-CSRF-Token':token})
        self.assertEqual(response.status_code,200)
        self.assertIsNone(self.get(client,'crew')['user'])
        self.assertEqual(self.post(self.app.test_client(),'/auth/login',dict(employee=employee,password=data['password'],role='crew'),'crew').status_code,401)

    def test_crew_edits_items_and_protects_payments(self):
        order,_=self.order()
        def edit(client,role,items,version=None):
            token=self.get(client,role)['csrf']
            return client.patch('/api/orders/'+order['id']+'/items',json=dict(items=items,reason='Customer requested a change',expectedUpdatedAt=version or order['updatedAt']),headers={'X-Portal':role,'X-CSRF-Token':token})
        items=[dict(id='T01',size='Ice',flavor='Original',qty=1,price=110)]
        self.assertEqual(edit(self.customer,'customer',items).status_code,401)
        self.assertEqual(edit(self.admin,'admin',items).status_code,403)
        response=edit(self.crew,'crew',items);self.assertEqual(response.status_code,200,response.json)
        old=order['updatedAt'];order=response.json['order']
        self.assertEqual(order['total'],110)
        self.assertEqual(edit(self.crew,'crew',items,old).status_code,409)
        self.assertEqual(edit(self.crew,'crew',[dict(items[0],qty=0)]).status_code,400)
        self.assertEqual(edit(self.crew,'crew',[dict(items[0],price=1)]).status_code,409)
        self.assertEqual(self.get(self.app.test_client())['orders'],[])
        proof=self.proof(order,reference=str(secrets.randbelow(10**13)).zfill(13));self.assertEqual(proof.status_code,201)
        proof_id=proof.json['proofId']
        order=next(o for o in self.get(self.crew,'crew')['orders'] if o['id']==order['id'])
        self.assertEqual(edit(self.crew,'crew',[dict(items[0],qty=2)]).status_code,409)
        changed=[dict(items[0],flavor='Wintermelon')]
        response=edit(self.crew,'crew',changed);self.assertEqual(response.status_code,200,response.json)
        order=response.json['order']
        proof=next(p for p in self.get(self.crew,'crew')['proofs'] if p['id']==proof_id)
        review=dict(decision='approve',reference=proof['reference'],receivedAmount=110,confirmedReceived=True)
        self.assertEqual(self.post(self.crew,'/payments/proofs/'+proof_id+'/review',review,'crew').status_code,200)
        order=next(o for o in self.get(self.crew,'crew')['orders'] if o['id']==order['id'])
        self.assertEqual(edit(self.crew,'crew',[dict(items[0],qty=2)]).status_code,409)
        response=edit(self.crew,'crew',items);self.assertEqual(response.status_code,200,response.json)
        order=response.json['order']
        self.assertEqual(order['paid'],110)
        customer_order=next(o for o in self.get(self.customer)['orders'] if o['id']==order['id'])
        self.assertEqual(customer_order['items'][0]['flavor'],'Original')
        self.assertEqual(self.post(self.crew,'/orders/'+order['id']+'/punch',{},'crew').status_code,200)
        self.assertEqual(edit(self.crew,'crew',items).status_code,409)

    def test_online_orders_require_active_crew_shift(self):
        order,_=self.order();order_id=order['id']
        proof=self.proof(order,reference=str(secrets.randbelow(10**13)).zfill(13));self.assertEqual(proof.status_code,201)
        proof_id=proof.json['proofId']
        self.assertEqual(self.post(self.crew,'/shifts/in',{},'crew').status_code,409)
        self.assertEqual(self.post(self.crew,'/shifts/out',{},'crew').status_code,200)
        off=self.get(self.crew,'crew')
        self.assertFalse(off['onShift']);self.assertFalse(any(o['source']=='Customer' for o in off['orders']));self.assertEqual(off['proofs'],[])
        self.assertEqual(self.post(self.crew,'/payments/proofs/'+proof_id+'/review',dict(decision='reject',note='Not received'),'crew').status_code,403)
        self.assertEqual(self.crew.get('/api/payments/proofs/'+proof_id+'/image').status_code,404)
        token=off['csrf']
        edit=self.crew.patch('/api/orders/'+order_id+'/items',json=dict(items=order['items'],reason='Test',expectedUpdatedAt=order['updatedAt']),headers={'X-Portal':'crew','X-CSRF-Token':token})
        self.assertEqual(edit.status_code,403)
        self.assertEqual(self.post(self.crew,'/orders/'+order_id+'/punch',{},'crew').status_code,403)
        self.assertEqual(self.post(self.crew,'/orders/'+order_id+'/status',dict(status='Cancelled'),'crew').status_code,403)
        self.assertEqual(self.post(self.admin,'/orders/'+order_id+'/status',dict(status='Cancelled'),'admin').status_code,403)
        self.assertEqual(self.post(self.crew,'/shifts/in',{},'crew').status_code,200)
        on=self.get(self.crew,'crew')
        self.assertTrue(on['onShift']);self.assertIn(order_id,[o['id'] for o in on['orders']])
        proof=next(p for p in on['proofs'] if p['id']==proof_id)
        review=dict(decision='approve',reference=proof['reference'],receivedAmount=95,confirmedReceived=True)
        self.assertEqual(self.post(self.crew,'/payments/proofs/'+proof_id+'/review',review,'crew').status_code,200)
        self.assertEqual(self.post(self.crew,'/orders/'+order_id+'/punch',{},'crew').status_code,200)
        self.assertEqual(self.post(self.crew,'/shifts/out',{},'crew').status_code,200)
        self.assertEqual(self.post(self.crew,'/orders/'+order_id+'/status',dict(status='Ready'),'crew').status_code,403)
        self.assertEqual(self.get(self.customer)['orders'][0]['status'],'Preparing')

    def test_rejection_and_ownership(self):
        order,_=self.order('Maya');reference=str(secrets.randbelow(10**13)).zfill(13);response=self.proof(order,reference=reference);self.assertEqual(response.status_code,201)
        proof_id=response.json['proofId']
        response=self.post(self.crew,'/payments/proofs/'+proof_id+'/review',dict(decision='reject',note='Reference not found in receiving wallet'),'crew')
        self.assertEqual(response.status_code,200)
        own=next(o for o in self.get(self.customer)['orders'] if o['id']==order['id'])
        self.assertEqual(own['paymentStatus'],'Rejected')
        self.assertIn(order['id'],[o['id'] for o in self.get(self.crew,'crew')['orders']])
        self.assertNotIn(order['id'],[o['id'] for o in self.get(self.app.test_client())['orders']])
        self.assertEqual(self.proof(order,reference=reference).status_code,201)


if __name__=='__main__': unittest.main(verbosity=2)
