"""Real MySQL integration checks; SMTP is captured, never sends test mail."""
import secrets
import smtplib
import sys
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from istilo import create_app
from istilo.common import now
from istilo.db import connect, execute, rows, transaction
from istilo.setup import initialize
from istilo.email_otp import send_code as smtp_send_code


class EmailOTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.database = 'istillo_otp_test_' + secrets.token_hex(6)
        cls.app = create_app(dict(TESTING=True, DB_NAME=cls.database, UPLOAD_FOLDER=cls.folder.name))
        with cls.app.app_context():
            initialize(cls.app)

    @classmethod
    def tearDownClass(cls):
        with cls.app.app_context():
            connection = connect(False)
            cursor = connection.cursor()
            assert cls.database.startswith('istillo_otp_test_')
            cursor.execute('DROP DATABASE `' + cls.database + '`')
            cursor.close()
            connection.close()
        cls.folder.cleanup()

    def setUp(self):
        self.client = self.app.test_client()
        self.client.get('/api/state')
        self.data = dict(name='OTP customer', email=secrets.token_hex(8)+'@example.com',
                         phone='09'+str(secrets.randbelow(10**9)).zfill(9), password='Test-Password!1', terms=True)
        self.mail = patch('istilo.email_otp.send_code').start()
        self.addCleanup(patch.stopall)
        with self.app.app_context(), transaction():
            execute('DELETE FROM login_attempts')

    def post(self, path, data=None, client=None):
        client = client or self.client
        with client.session_transaction() as session:
            csrf = session['csrf']
        return client.post('/api/auth/customer/'+path, json=data or {}, headers={'X-CSRF-Token':csrf, 'X-Portal':'customer'})

    def register(self):
        result = self.post('register', self.data)
        self.assertEqual(result.status_code, 201, result.json)
        self.assertNotIn('code', result.json)
        return self.mail.call_args.args[1]

    def age(self, **fields):
        with self.app.app_context(), transaction():
            for column, value in fields.items():
                assert column in ('expires_at', 'last_sent_at')
                execute('UPDATE pending_account_verifications SET '+column+'=%s WHERE user_email=%s', (value,self.data['email']))

    def test_success_login_and_single_use(self):
        code = self.register()
        with self.app.app_context():
            pending = rows('SELECT * FROM pending_account_verifications WHERE user_email=%s',(self.data['email'],),one=True)
            self.assertNotIn(code, pending['otp_hash'])
            self.assertEqual(rows('SELECT email_verified FROM accounts WHERE user_email=%s',(self.data['email'],),one=True)['email_verified'],0)
        credentials = dict(identifier=self.data['email'], password=self.data['password'])
        self.assertEqual(self.post('login', credentials).status_code,403)
        other = self.app.test_client()
        other.get('/api/state')
        self.assertEqual(self.post('verify-email',dict(code=code),other).status_code,400)
        self.assertEqual(self.post('verify-email',dict(code=code)).status_code,200)
        self.assertEqual(self.post('verify-email',dict(code=code)).status_code,400)
        with self.client.session_transaction() as session:
            self.assertNotIn('customer_id',session)
        self.assertEqual(self.post('login',credentials).status_code,200)

    def test_incorrect_attempts_expiry_and_resend(self):
        code = self.register()
        wrong = '000000' if code != '000000' else '111111'
        for _ in range(5):
            self.assertEqual(self.post('verify-email',dict(code=wrong)).status_code,400)
        self.assertEqual(self.post('verify-email',dict(code=code)).status_code,429)
        self.assertEqual(self.post('resend-otp').status_code,429)
        self.age(last_sent_at=now()-timedelta(seconds=61))
        self.assertEqual(self.post('resend-otp').status_code,200)
        new_code = self.mail.call_args.args[1]
        if new_code != code:
            self.assertEqual(self.post('verify-email',dict(code=code)).status_code,400)
        self.age(expires_at=now()-timedelta(seconds=1))
        expired=self.post('verify-email',dict(code=new_code))
        self.assertEqual(expired.status_code,400)
        self.assertIn('expired',expired.json['error'])

    def test_duplicates_and_delivery_rollback(self):
        self.mail.side_effect = OSError('SMTP unavailable')
        self.assertEqual(self.post('register',self.data).status_code,503)
        with self.app.app_context():
            self.assertIsNone(rows('SELECT * FROM accounts WHERE user_email=%s',(self.data['email'],),one=True))
        self.mail.side_effect = None
        self.register()
        self.assertEqual(self.post('register',self.data).status_code,409)
        self.data['email'] = 'another-'+self.data['email']
        self.assertEqual(self.post('register',self.data).status_code,409)

    def test_rate_limit_and_terms(self):
        self.data['terms']=False
        for _ in range(10):
            self.assertEqual(self.post('register',self.data).status_code,400)
        self.assertEqual(self.post('register',self.data).status_code,429)

    def test_failed_resend_preserves_previous_code_and_reload_state(self):
        code = self.register()
        self.assertTrue(self.client.get('/api/auth/customer/registration-status').json['pending'])
        self.age(last_sent_at=now()-timedelta(seconds=61))
        self.mail.side_effect = OSError('SMTP unavailable')
        self.assertEqual(self.post('resend-otp').status_code,503)
        self.assertEqual(self.post('verify-email',dict(code=code)).status_code,200)

    def test_smtp_transport(self):
        self.app.config.update(SMTP_HOST='smtp.example.com', SMTP_SSL=False, SMTP_PORT=587, SMTP_USERNAME='sender@example.com',
                               SMTP_PASSWORD='test-only-password', SMTP_FROM='sender@example.com')
        # Restore the actual transport function for this one unit check.
        with patch('istilo.email_otp.smtplib.SMTP') as transport, self.app.app_context():
            smtp_send_code('recipient@example.com', '654321')
            smtp=transport.return_value.__enter__.return_value
            smtp.starttls.assert_called_once()
            smtp.login.assert_called_once_with('sender@example.com','test-only-password')
            message=smtp.send_message.call_args.args[0]
            self.assertEqual(message['Subject'],'ISTILO Coffee Shop - Email Verification')
            self.assertIn('654321',message.get_content())

    def test_missing_sender_and_rejected_smtp_login(self):
        with self.app.app_context(), patch.dict(self.app.config, SMTP_USERNAME=''):
            with self.assertRaisesRegex(RuntimeError, 'not configured'):
                smtp_send_code('recipient@example.com', '654321')
        self.mail.side_effect=smtplib.SMTPAuthenticationError(535,b'Login rejected')
        response=self.post('register',self.data)
        self.assertEqual(response.status_code,503)
        self.assertIn('rejected the sender login',response.json['error'])

    def test_migration_can_rerun(self):
        self.register()
        runner=self.app.test_cli_runner()
        for _ in range(2):
            result=runner.invoke(args=['upgrade-email-otp'])
            self.assertEqual(result.exit_code,0,result.output)
        with self.app.app_context():
            account=rows('SELECT * FROM accounts WHERE user_email=%s',(self.data['email'],),one=True)
            self.assertEqual(account['email_verified'],0)
            self.assertEqual(account['name'],self.data['name'])

    def begin_password_change(self):
        registration_code=self.register()
        self.assertEqual(self.post('verify-email',dict(code=registration_code)).status_code,200)
        result=self.post('reset-password',dict(identifier=self.data['email'],password='New-Password!123'))
        self.assertEqual(result.status_code,200,result.json)
        self.assertTrue(result.json['pending'])
        self.assertEqual(self.mail.call_args.args[2],'password')
        return self.mail.call_args.args[1]

    def test_password_requires_otp_and_cannot_replay(self):
        code=self.begin_password_change()
        old=dict(identifier=self.data['email'],password=self.data['password'])
        new=dict(identifier=self.data['email'],password='New-Password!123')
        self.assertEqual(self.post('login',old).status_code,200)
        self.assertEqual(self.post('login',new).status_code,401)
        other=self.app.test_client()
        other.get('/api/state')
        self.assertEqual(self.post('reset-password/verify',dict(code=code),other).status_code,400)
        self.assertEqual(self.post('verify-email',dict(code=code)).status_code,400)
        self.assertEqual(self.post('reset-password/verify',dict(code=code)).status_code,200)
        with self.client.session_transaction() as session:
            self.assertNotIn('customer_id',session)
        self.assertEqual(self.post('reset-password/verify',dict(code=code)).status_code,400)
        self.assertEqual(self.post('login',old).status_code,401)
        self.assertEqual(self.post('login',new).status_code,200)

    def test_password_resend_expiry_and_attempt_limit(self):
        code=self.begin_password_change()
        self.assertEqual(self.post('reset-password/resend').status_code,429)
        wrong='000000' if code!='000000' else '111111'
        for _ in range(5):
            self.assertEqual(self.post('reset-password/verify',dict(code=wrong)).status_code,400)
        self.assertEqual(self.post('reset-password/verify',dict(code=code)).status_code,429)
        with self.app.app_context(), transaction():
            execute('UPDATE password_change_verifications SET last_sent_at=%s WHERE user_email=%s',
                    (now()-timedelta(seconds=61),self.data['email']))
        self.assertEqual(self.post('reset-password/resend').status_code,200)
        new_code=self.mail.call_args.args[1]
        self.assertNotEqual(new_code,code)
        self.assertEqual(self.post('reset-password/verify',dict(code=code)).status_code,400)
        with self.app.app_context(), transaction():
            execute('UPDATE password_change_verifications SET expires_at=%s WHERE user_email=%s',
                    (now()-timedelta(seconds=1),self.data['email']))
        response=self.post('reset-password/verify',dict(code=new_code))
        self.assertEqual(response.status_code,400)
        self.assertIn('expired',response.json['error'])

    def test_password_send_failure_does_not_change_password(self):
        code=self.register()
        self.assertEqual(self.post('verify-email',dict(code=code)).status_code,200)
        self.mail.side_effect=OSError('SMTP unavailable')
        self.assertEqual(self.post('reset-password',dict(identifier=self.data['phone'],password='New-Password!123')).status_code,503)
        self.assertEqual(self.post('login',dict(identifier=self.data['email'],password=self.data['password'])).status_code,200)


if __name__ == '__main__':
    unittest.main()
