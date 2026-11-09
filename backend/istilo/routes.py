import json
import re
from pathlib import Path
from datetime import date
from uuid import uuid4

from flask import Blueprint, abort, current_app, jsonify, request, session
from werkzeug.security import generate_password_hash
from werkzeug.utils import secure_filename

from .auth import user_json
from .common import active_shift, require_online_shift, actor, cents, event, iso, now, own_order, payload, require, text, uid
from .db import execute, rows, transaction

api = Blueprint('api', __name__)
CATEGORIES = ['Coffee', 'Milk Tea', 'Frappe', 'Latte', 'Matcha', 'Snacks']
ICONS = dict(zip(CATEGORIES, ['☕', '🧋', '🥤', '☕', '🍵', '🥐']))
TRANSITIONS = {'Pending': ['Preparing', 'Cancelled'], 'Preparing': ['Ready', 'Cancelled'], 'Ready': ['Completed'], 'Completed': [], 'Cancelled': []}


def product_json(p):
    return dict(id=p['id'], name=p['name'], category=p['category'], description=p['description'], price=p['price_cents']/100,
                flavors=json.loads(p['flavors']), sizes=[dict(name=s['name'], extra=s['extra_cents']/100) for s in json.loads(p['sizes'])], icon=p['icon'], imageUrl=p.get('image_url',''),
                imagePosition=p.get('image_position','center'), imageScale=float(p.get('image_scale') or 1), available=bool(p['available']))


def order_json(o):
    items = rows('SELECT * FROM order_items WHERE order_id=%s ORDER BY id', (o['id'],))
    proof = rows('SELECT id,status,review_note FROM payment_proofs WHERE order_id=%s ORDER BY created_at DESC LIMIT 1', (o['id'],), one=True)
    return dict(id=o['id'], customer=o['customer'], phone=o['phone'], notes=o['notes'], source=o['source'], type=o['order_type'],
                status=o['status'], payment=o['payment_method'], paymentStatus=o['payment_status'], total=o['total_cents']/100,
                paid=o['cash_received_cents']/100, change=o['change_cents']/100, time=iso(o['created_at']), updatedAt=iso(o['updated_at']),
                createdBy=o['created_by'], collectedBy=o['collected_by'], collectedAt=iso(o['collected_at']),
                punchedAt=iso(o['punched_at']), punchedBy=o['punched_by'], releasedAt=iso(o['released_at']),
                proof=dict(id=proof['id'], status=proof['status'], note=proof['review_note']) if proof else None,
                items=[dict(id=i['product_id'],name=i['name'],size=i['size'],flavor=i['flavor'],qty=i['quantity'],price=i['unit_price_cents']/100) for i in items])


def visible_orders(user):
    if user and user['role'] == 'admin':
        return rows('SELECT * FROM orders ORDER BY created_at')
    if user and user['role'] == 'crew':
        return rows('SELECT * FROM orders ORDER BY created_at')
    return rows('SELECT * FROM orders WHERE customer_token=%s ORDER BY created_at', (session['customer_token'],))


@api.get('/state')
def state():
    user = actor()
    customer = None
    if request.headers.get('X-Portal') == 'customer' and session.get('customer_id') and session.get('customer_verified'):
        customer_row = rows('SELECT * FROM accounts WHERE user_id=%s AND email_verified=1',
                            (session['customer_id'],), one=True)
        if customer_row:
            customer = dict(id=customer_row['user_id'], email=customer_row['user_email'],
                            name=customer_row.get('name', ''), phone=customer_row['phone'], verified=True)
    products = [product_json(p) for p in rows('SELECT * FROM products ORDER BY category,name')]
    staff = rows('SELECT * FROM users ORDER BY role,employee_id') if user and user['role'] == 'admin' else ([user] if user else [])
    proofs = []
    if user and user['role'] == 'crew':
        proofs = [dict(id=p['id'], orderId=p['order_id'], reference=p['reference_number'], amount=p['amount_cents']/100, wallet=p['wallet'], status=p['status'], time=iso(p['created_at']), note=p['review_note'], imageUrl='/api/payments/proofs/'+p['id']+'/image') for p in rows('SELECT * FROM payment_proofs ORDER BY created_at DESC')]
    inquiries = []
    shifts = []
    expenses = []
    inventory = []
    inventory_adjustments = []
    if user:
        if user['role'] == 'admin':
            inquiries = [dict(id=m['id'],name=m['name'],email=m['email'],topic=m['topic'],message=m['message'],note=m['note'],status=m['status'],time=iso(m['created_at'])) for m in rows('SELECT * FROM inquiries ORDER BY created_at')]
        shifts = [dict(id=s['id'],employee=user['employee_id'],start=iso(s['start_at']),end=iso(s['end_at']),note=s['note']) for s in rows('SELECT * FROM shifts WHERE employee_id=%s ORDER BY start_at', (user['id'],))]
        if user['role'] == 'admin':
            expenses = [dict(id=x['id'],name=x['name'],category=x['category'],amount=x['amount_cents']/100,date=str(x['expense_date']),description=x['description']) for x in rows('SELECT * FROM expenses ORDER BY expense_date')]
            inventory = [dict(id=i['id'],name=i['name'],category=i['category'],unit=i['unit'],quantity=float(i['quantity']),minimum=float(i['minimum']),active=bool(i['active']),updatedAt=iso(i['updated_at'])) for i in rows('SELECT * FROM inventory_items WHERE active=1 ORDER BY category,name')]
            inventory_adjustments = [dict(id=a['id'],itemId=a['item_id'],itemName=rows('SELECT name FROM inventory_items WHERE id=%s',(a['item_id'],),one=True)['name'],change=float(a['change_amount']),quantityAfter=float(a['quantity_after']),adjustedBy=a['adjusted_by'],time=iso(a['created_at'])) for a in rows('SELECT * FROM inventory_adjustments ORDER BY created_at DESC LIMIT 100')]
    return jsonify(csrf=session['csrf'], user=user_json(user), customer=customer, onShift=bool(active_shift(user) or (user and user['role'] == 'crew')), products=products, orders=[order_json(o) for o in visible_orders(user)],
                   availability={p['id']:p['available'] for p in products}, staff=[user_json(s) for s in staff],
                   inquiries=inquiries, expenses=expenses, inventory=inventory, inventoryAdjustments=inventory_adjustments, shifts=shifts, proofs=proofs,
                   profiles={user['employee_id']:dict(name=user['name'],email=user['email'])} if user else {},
                   business=dict(name='ISTILO',tagline='Coffee with style.',address='Canlubang, Calamba, Palao, Paikit, 4027',owner='',
                                 founded='',email='',phone='09196281147',hours='',crew=[],story='Welcome to ISTILO. Find your favorite coffee, milk tea, frappe, latte, matcha, and snacks.'),
                   wallets=[dict(method='GCash',name=current_app.config['GCASH_NAME'],number=current_app.config['GCASH_NUMBER']),dict(method='Maya',name=current_app.config['MAYA_NAME'],number=current_app.config['MAYA_NUMBER'])])


@api.get('/health')
def health():
    connection = rows('SELECT DATABASE() AS name', one=True)
    return jsonify(status='ok', database=connection['name'], connected=True)


@api.post('/products')
@require('admin')
def save_product():
    data = request.get_json(silent=True) if request.is_json else request.form.to_dict()
    if not isinstance(data, dict):
        abort(400, description='Invalid product data.')
    category = data.get('category')
    if category not in CATEGORIES:
        abort(400, description='Choose one of the six menu categories.')
    name = text(data.get('name', ''),100,True)
    price = cents(data.get('price'),True)
    flavors_value = data.get('flavors', ['Original'])
    if isinstance(flavors_value, str):
        try:
            flavors_value = json.loads(flavors_value)
        except json.JSONDecodeError:
            flavors_value = flavors_value.split(',')
    flavors = flavors_value
    if not isinstance(flavors,list) or not 1 <= len(flavors) <= 20:
        abort(400, description='Provide between one and twenty flavors.')
    flavors = list(dict.fromkeys(text(f,100,True) for f in flavors))
    extra = cents(data.get('largeExtra',20))
    sizes = [dict(name='Regular',extra_cents=0)] if category=='Snacks' else [dict(name='Hot',extra_cents=0),dict(name='Ice',extra_cents=0)]
    image_position = data.get('imagePosition', 'center')
    if image_position not in ('center','top','bottom','left','right','top left','top right','bottom left','bottom right'):
        image_position = 'center'
    try:
        image_scale = float(data.get('imageScale', 1))
    except (TypeError, ValueError):
        image_scale = 1
    image_scale = max(1, min(2.5, image_scale))
    product_id = data.get('id') or uid('P')
    with transaction():
        if data.get('id') and not rows('SELECT id FROM products WHERE id=%s FOR UPDATE',(product_id,),one=True):
            abort(404)
        existing = rows('SELECT image_url,image_position,image_scale FROM products WHERE id=%s',(product_id,),one=True) if data.get('id') else None
        image_url = existing['image_url'] if existing else ''
        upload = request.files.get('image')
        if upload and upload.filename:
            allowed = {'.jpg','.jpeg','.png','.webp'}
            extension = Path(secure_filename(upload.filename)).suffix.lower()
            if extension not in allowed:
                abort(400, description='Choose a JPG, PNG, or WEBP product image.')
            folder = Path(current_app.instance_path) / 'product-images'
            folder.mkdir(parents=True, exist_ok=True)
            filename = f'{product_id}-{uuid4().hex}{extension}'
            upload.save(folder / filename)
            image_url = f'/api/product-images/{filename}'
        execute('INSERT INTO products(id,name,category,description,price_cents,flavors,sizes,icon,image_url,image_position,image_scale) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE name=VALUES(name),category=VALUES(category),description=VALUES(description),price_cents=VALUES(price_cents),flavors=VALUES(flavors),sizes=VALUES(sizes),icon=VALUES(icon),image_url=VALUES(image_url),image_position=VALUES(image_position),image_scale=VALUES(image_scale)',
                (product_id,name,category,text(data.get('description',''),2000),price,json.dumps(flavors),json.dumps(sizes),ICONS[category],image_url,image_position,image_scale))
    return jsonify(product=product_json(rows('SELECT * FROM products WHERE id=%s',(product_id,),one=True)))




@api.patch('/products/<product_id>/availability')
@require('crew','admin')
def availability(product_id):
    value = payload().get('available')
    if not isinstance(value,bool): abort(400)
    with transaction():
        if not rows('SELECT id FROM products WHERE id=%s FOR UPDATE',(product_id,),one=True): abort(404)
        execute('UPDATE products SET available=%s WHERE id=%s',(value,product_id))
    return jsonify(ok=True)


def validated_items(items, existing=()):
    if not isinstance(items,list) or not 1 <= len(items) <= 60:
        abort(400,description="Choose 1-60 items.")
    historical={(i["product_id"],i["size"],i["flavor"]):i["unit_price_cents"] for i in existing}
    item_rows, total = [], 0
    for item in sorted(items,key=lambda item: str(item.get('id','')) if isinstance(item,dict) else ''):
        if not isinstance(item,dict): abort(400)
        p = rows('SELECT * FROM products WHERE id=%s FOR UPDATE',(item.get('id'),),one=True)
        if not p or not p['available']: abort(409,description='A selected product is no longer available.')
        qty = item.get('qty')
        if isinstance(qty,bool) or not isinstance(qty,int) or not 1 <= qty <= 99: abort(400,description='Quantity must be 1–99.')
        selected_type = item.get('size')
        size = {'name': selected_type, 'extra_cents': 0} if selected_type in ('Hot','Ice') or (p['category']=='Snacks' and selected_type=='Regular') else next((s for s in json.loads(p['sizes']) if s['name']==selected_type),None)
        if not size or item.get('flavor') not in json.loads(p['flavors']): abort(400,description='Choose valid product options.')
        unit = historical.get((p['id'],size['name'],item['flavor']), p['price_cents'] + size['extra_cents'])
        if 'price' not in item or cents(item['price']) != unit: abort(409,description='The menu price changed. Review your cart and try again.')
        total += unit * qty
        if total>100000000: abort(400,description='This order exceeds the supported total. Contact the shop.')
        item_rows.append((p['id'],p['name'],item['flavor'],size['name'],qty,unit))
    return item_rows, total


@api.post('/orders')
def create_order():
    data = payload()
    user = actor()
    source = data.get('source','Customer')
    if source not in ('Customer','Counter'): abort(400)
    if source=='Counter' and (not user or user['role'] not in ('crew','admin')): abort(403)
    if source=='Customer' and (not session.get('customer_id') or not session.get('customer_verified')):
        abort(401, description='Sign in with a verified customer account before placing an order.')
    if source=='Customer' and data.get('termsAccepted') is not True:
        abort(400, description='You must agree to the Terms and Conditions and Privacy Policy before placing an order.')
    method = data.get('payment')
    if method not in (('GCash','Maya') if source=='Customer' else ('Cash','Pay at counter')):
        abort(400,description='Online orders require GCash or Maya payment with proof.')
    customer_name = ''
    customer_phone = ''
    if source == 'Customer':
        account = rows('SELECT name,user_email,phone FROM accounts WHERE user_id=%s AND email_verified=1',
                       (session['customer_id'],), one=True)
        if not account or not account['name'] or not account['phone']:
            abort(400, description='Add your name and contact number to your Profile before placing an order.')
        customer_name = account['name']
        customer_phone = account['phone']
    items = data.get('items')
    if not isinstance(items,list) or not 1 <= len(items) <= 60: abort(400,description='Choose 1–60 items.')
    request_key = text(data.get('requestKey',''),64,True)
    with transaction():
        previous = rows('SELECT * FROM orders WHERE request_key=%s FOR UPDATE',(request_key,),one=True)
        if previous:
            own_order(previous)
            return jsonify(order=order_json(previous))
        item_rows, total = validated_items(items)
        paid = cents(data.get('paid',0)) if method=='Cash' else 0
        if method=='Cash' and paid < total: abort(400,description='Cash received must cover the total.')
        order_id, timestamp = uid('ORD'), now()
        status = 'Completed' if source=='Counter' and method=='Cash' else 'Preparing' if source=='Counter' else 'Pending'
        payment_status = 'Verified' if method=='Cash' else 'Unpaid' if source=='Counter' else 'Awaiting proof'
        execute('INSERT INTO orders(id,customer_token,request_key,customer,phone,notes,source,order_type,status,total_cents,payment_method,payment_status,cash_received_cents,change_cents,created_by,punched_at,punched_by,collected_at,collected_by,released_at,created_at,updated_at) VALUES('+','.join(['%s']*22)+')',
                (order_id,session['customer_token'] if source=='Customer' else None,request_key,customer_name if source=='Customer' else text(data.get('customer','Walk-in customer'),100,True),customer_phone if source=='Customer' else text(data.get('phone',''),40),text(data.get('notes',''),500),source,'Pickup' if source=='Customer' else text(data.get('type','Pickup'),30),status,total,method,payment_status,paid,max(0,paid-total),user['id'] if user else None,timestamp if source=='Counter' else None,user['id'] if source=='Counter' else None,timestamp if method=='Cash' else None,user['id'] if method=='Cash' else None,timestamp if source=='Counter' else None,timestamp,timestamp))
        for item in item_rows:
            execute('INSERT INTO order_items(order_id,product_id,name,flavor,size,quantity,unit_price_cents) VALUES(%s,%s,%s,%s,%s,%s,%s)',(order_id,*item))
        event(order_id,'created',source, user['id'] if user else None)
    return jsonify(order=order_json(rows('SELECT * FROM orders WHERE id=%s',(order_id,),one=True))),201


@api.patch('/orders/<order_id>/items')
@require('crew')
def edit_order_items(order_id):
    data=payload()
    reason=text(data.get('reason',''),300,True)
    with transaction():
        order=rows('SELECT * FROM orders WHERE id=%s FOR UPDATE',(order_id,),one=True)
        if not order or order['source']!='Customer': abort(404)
        require_online_shift(order)
        if order['status']!='Pending' or order['punched_at']:
            abort(409,description='Items can only be edited before preparation starts.')
        if data.get('expectedUpdatedAt')!=iso(order['updated_at']):
            abort(409,description='This order changed. Close the editor and reopen it before saving.')
        existing=rows('SELECT * FROM order_items WHERE order_id=%s',(order_id,))
        items,total=validated_items(data.get('items'),existing)
        if order['payment_status'] in ('Verified','Under review') and total!=order['total_cents']:
            abort(409,description='The total must stay the same while payment is under review or verified. Reject an unverified receipt before changing the amount.')
        execute('DELETE FROM order_items WHERE order_id=%s',(order_id,))
        for item in items:
            execute('INSERT INTO order_items(order_id,product_id,name,flavor,size,quantity,unit_price_cents) VALUES(%s,%s,%s,%s,%s,%s,%s)',(order_id,*item))
        execute('UPDATE orders SET total_cents=%s,updated_at=%s WHERE id=%s',(total,now(),order_id))
        event(order_id,'items_edited',reason,actor()['id'])
    return jsonify(order=order_json(rows('SELECT * FROM orders WHERE id=%s',(order_id,),one=True)))


@api.delete('/orders/<order_id>')
@require('crew','admin')
def delete_order(order_id):
    proof_files = []
    with transaction():
        order = rows('SELECT * FROM orders WHERE id=%s FOR UPDATE',(order_id,),one=True)
        if not order or order['source'] != 'Customer':
            abort(404,description='Customer order not found.')
        require_online_shift(order)
        proofs = rows('SELECT storage_name FROM payment_proofs WHERE order_id=%s',(order_id,))
        proof_files = [Path(current_app.config['UPLOAD_FOLDER'])/proof['storage_name'] for proof in proofs]
        execute('DELETE FROM payment_references WHERE order_id=%s',(order_id,))
        execute('DELETE FROM payment_proofs WHERE order_id=%s',(order_id,))
        execute('DELETE FROM order_events WHERE order_id=%s',(order_id,))
        execute('DELETE FROM order_items WHERE order_id=%s',(order_id,))
        execute('DELETE FROM orders WHERE id=%s',(order_id,))
    for proof_file in proof_files:
        try:
            proof_file.unlink(missing_ok=True)
        except OSError:
            current_app.logger.exception('Could not remove deleted order payment proof file')
    return jsonify(ok=True)


@api.post('/orders/<order_id>/punch')
@require('crew','admin')
def punch(order_id):
    with transaction():
        order = rows('SELECT * FROM orders WHERE id=%s FOR UPDATE',(order_id,),one=True)
        require_online_shift(order)
        own_order(order)
        if order['payment_status']!='Verified' or not order['released_at']: abort(409,description='Verified online payment and approved proof are required before punching.')
        if order['status']!='Pending' or order['punched_at']: abort(409,description='This order has already been punched or changed.')
        execute("UPDATE orders SET status='Preparing',punched_at=%s,punched_by=%s,updated_at=%s WHERE id=%s",(now(),actor()['id'],now(),order_id))
        event(order_id,'punched','Manually accepted by crew',actor()['id'])
    return jsonify(ok=True)


@api.post('/orders/<order_id>/status')
@require('crew','admin')
def set_status(order_id):
    next_status = payload().get('status')
    with transaction():
        order = rows('SELECT * FROM orders WHERE id=%s FOR UPDATE',(order_id,),one=True)
        require_online_shift(order)
        own_order(order)
        if next_status not in TRANSITIONS[order['status']]: abort(409,description='Invalid order status transition.')
        if next_status=='Preparing' and order['source']=='Customer' and not order['punched_at']: abort(409,description='Crew must punch this order first.')
        if next_status=='Completed' and order['payment_status']!='Verified': abort(409,description='Payment must be verified before completion.')
        if order['source']=='Customer' and order['payment_status']!='Verified' and next_status!='Cancelled': abort(409)
        execute('UPDATE orders SET status=%s,updated_at=%s WHERE id=%s',(next_status,now(),order_id))
        event(order_id,'status',next_status,actor()['id'])
    return jsonify(ok=True)


@api.post('/orders/<order_id>/cash')
@require('crew','admin')
def collect_cash(order_id):
    paid = cents(payload().get('paid'))
    with transaction():
        order = rows('SELECT * FROM orders WHERE id=%s FOR UPDATE',(order_id,),one=True)
        require_online_shift(order)
        own_order(order)
        if order['source']!='Counter' or order['payment_status']=='Verified' or order['status'] in ('Cancelled','Completed'): abort(409,description='This order cannot accept a cash payment.')
        if paid < order['total_cents']: abort(400,description='Cash received must cover the total.')
        execute("UPDATE orders SET payment_status='Verified',cash_received_cents=%s,change_cents=%s,collected_at=%s,collected_by=%s WHERE id=%s",(paid,paid-order['total_cents'],now(),actor()['id'],order_id))
        event(order_id,'cash_received','Cash recorded',actor()['id'])
    return jsonify(order=order_json(rows('SELECT * FROM orders WHERE id=%s',(order_id,),one=True)))


@api.post('/inquiries')
def inquiry():
    data = payload()
    email = text(data.get('email',''),150,True)
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email): abort(400,description='Enter a valid email address.')
    with transaction():
        execute('INSERT INTO inquiries(id,customer_token,name,email,topic,message,note) VALUES(%s,%s,%s,%s,%s,%s,%s)',(uid('MSG'),session['customer_token'],text(data.get('name',''),100,True),email,text(data.get('topic','General'),100,True),text(data.get('message',''),2000,True),''))
    return jsonify(ok=True),201


@api.patch('/inquiries/<message_id>')
@require('admin')
def update_inquiry(message_id):
    data = payload()
    with transaction():
        message = rows('SELECT * FROM inquiries WHERE id=%s FOR UPDATE',(message_id,),one=True)
        if not message: abort(404)
        status = data.get('status',message['status'])
        if status not in ('New','In progress','Resolved'): abort(400)
        execute('UPDATE inquiries SET note=%s,status=%s WHERE id=%s',(text(data.get('note',message['note']),2000),status,message_id))
    return jsonify(ok=True)


@api.post('/inventory')
@require('admin')
def inventory_create():
    data=payload()
    name=text(data.get('name',''),100,True)
    category=text(data.get('category','Ingredients'),60,True)
    unit=text(data.get('unit',''),30,True)
    try:
        quantity=float(data.get('quantity',0))
        minimum=float(data.get('minimum',0))
    except (TypeError,ValueError):
        abort(400,description='Enter valid quantity and minimum values.')
    if quantity < 0 or minimum < 0 or not quantity.is_integer() or not minimum.is_integer():
        abort(400,description='Quantity and minimum must be whole numbers.')
    with transaction():
        execute('INSERT INTO inventory_items(id,name,category,unit,quantity,minimum) VALUES(%s,%s,%s,%s,%s,%s)',
                (uid('INV'),name,category,unit,quantity,minimum))
    return jsonify(ok=True),201


@api.delete('/inventory/<item_id>')
@require('admin')
def inventory_remove(item_id):
    with transaction():
        item=rows('SELECT id FROM inventory_items WHERE id=%s FOR UPDATE',(item_id,),one=True)
        if not item: abort(404,description='Ingredient not found.')
        execute('DELETE FROM inventory_adjustments WHERE item_id=%s',(item_id,))
        execute('DELETE FROM inventory_items WHERE id=%s',(item_id,))
    return jsonify(ok=True)


@api.post('/inventory/<item_id>/delete')
@require('admin')
def inventory_delete(item_id):
    with transaction():
        item=rows('SELECT id FROM inventory_items WHERE id=%s FOR UPDATE',(item_id,),one=True)
        if not item: abort(404,description='Ingredient not found.')
        execute('DELETE FROM inventory_adjustments WHERE item_id=%s',(item_id,))
        execute('DELETE FROM inventory_items WHERE id=%s',(item_id,))
    return jsonify(ok=True)


@api.patch('/inventory/<item_id>')
@require('admin')
def inventory_edit(item_id):
    data=payload()
    name=text(data.get('name',''),100,True)
    category=text(data.get('category',''),60,True)
    unit=text(data.get('unit',''),30,True)
    with transaction():
        item=rows('SELECT id FROM inventory_items WHERE id=%s FOR UPDATE',(item_id,),one=True)
        if not item: abort(404,description='Ingredient not found.')
        execute('UPDATE inventory_items SET name=%s,category=%s,unit=%s WHERE id=%s',
                (name,category,unit,item_id))
    return jsonify(ok=True)


@api.post('/inventory/<item_id>/adjust')
@require('admin')
def inventory_adjust(item_id):
    data=payload()
    mode=data.get('mode','add')
    if mode not in ('add','deduct'): abort(400,description='Choose add or deduct.')
    try:
        amount=float(data.get('amount',0))
    except (TypeError,ValueError):
        abort(400,description='Enter a valid quantity.')
    if not (amount > 0 and amount.is_integer()):
        abort(400,description='Adjustment must be a whole number greater than zero.')
    reason=''
    with transaction():
        item=rows('SELECT * FROM inventory_items WHERE id=%s FOR UPDATE',(item_id,),one=True)
        if not item or not item['active']: abort(404,description='Ingredient not found.')
        current=float(item['quantity'])
        change=amount if mode=='add' else -amount
        quantity=current+change
        if quantity < 0: abort(400,description='Cannot deduct more than the available stock.')
        execute('UPDATE inventory_items SET quantity=%s WHERE id=%s',(quantity,item_id))
        execute('INSERT INTO inventory_adjustments(id,item_id,change_amount,quantity_after,reason,adjusted_by) VALUES(%s,%s,%s,%s,%s,%s)',
                (uid('ADJ'),item_id,change,quantity,reason,actor()['id']))
    return jsonify(ok=True)


@api.post('/staff')
@require('admin')
def staff():
    data=payload()
    employee=text(data.get('employeeId',''),40,True).upper()
    if not re.fullmatch(r'[A-Z0-9_-]+',employee): abort(400)
    password=text(data.get('password',''),200,True)
    if len(password)<12: abort(400,description='Use a password with at least 12 characters.')
    role=data.get('role','crew')
    if role not in ('admin','crew'): abort(400,description='Choose a valid account role.')
    name=text(data.get('name',''),100,True)
    email=text(data.get('email',''),150)
    with transaction():
        execute('INSERT INTO users(id,employee_id,name,email,password_hash,role) VALUES(%s,%s,%s,%s,%s,%s)',
                (uid('USR'),employee,name,email,generate_password_hash(password),role))
    return jsonify(ok=True),201
@api.patch('/staff/<user_id>')
@require('admin')
def staff_update(user_id):
    active=payload().get('active')
    if not isinstance(active,bool): abort(400)
    with transaction():
        member=rows('SELECT * FROM users WHERE id=%s FOR UPDATE',(user_id,),one=True)
        if not member: abort(404)
        current=actor()
        if current and member['id']==current['id']: abort(400,description='You cannot deactivate your own account.')
        execute('UPDATE users SET active=%s WHERE id=%s',(active,user_id))
    return jsonify(ok=True)


@api.patch('/profile')
@require('crew','admin')
def profile():
    data=payload()
    with transaction():
        execute('UPDATE users SET name=%s,email=%s WHERE id=%s',(text(data.get('name',''),100,True),text(data.get('email',''),150),actor()['id']))
    return jsonify(ok=True)


@api.post('/shifts/in')
@require('crew','admin')
def clock_in():
    with transaction():
        rows('SELECT id FROM users WHERE id=%s FOR UPDATE',(actor()['id'],),one=True)
        if active_shift(actor()): abort(409,description='You are already clocked in.')
        execute('INSERT INTO shifts(id,employee_id,start_at) VALUES(%s,%s,%s)',(uid('SHIFT'),actor()['id'],now()))
    return jsonify(ok=True)


@api.post('/shifts/out')
@require('crew','admin')
def clock_out():
    note=text(payload().get('note',''),1000)
    with transaction():
        rows('SELECT id FROM users WHERE id=%s FOR UPDATE',(actor()['id'],),one=True)
        shift=rows('SELECT id FROM shifts WHERE employee_id=%s AND end_at IS NULL FOR UPDATE',(actor()['id'],),one=True)
        if not shift: abort(409,description='No active shift.')
        execute('UPDATE shifts SET end_at=%s,note=%s WHERE id=%s',(now(),note,shift['id']))
    return jsonify(ok=True)


@api.post('/expenses')
@require('admin')
def expense():
    data=payload()
    try: day=date.fromisoformat(data.get('date',''))
    except (ValueError,TypeError): abort(400,description='Enter a valid expense date.')
    expense_id=data.get('id') or uid('EXP')
    with transaction():
        execute('INSERT INTO expenses(id,name,category,amount_cents,expense_date,description,created_by) VALUES(%s,%s,%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE name=VALUES(name),category=VALUES(category),amount_cents=VALUES(amount_cents),expense_date=VALUES(expense_date),description=VALUES(description)',(expense_id,text(data.get('name',''),100,True),text(data.get('category',''),60,True),cents(data.get('amount'),True),day,text(data.get('description',''),500),actor()['id']))
    return jsonify(ok=True)


@api.delete('/expenses/<expense_id>')
@require('admin')
def delete_expense(expense_id):
    with transaction(): execute('DELETE FROM expenses WHERE id=%s',(expense_id,))
    return jsonify(ok=True)
