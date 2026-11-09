"""Headless Chrome registration smoke check using a disposable MySQL database."""
import os
import secrets
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from flask import Response
from werkzeug.serving import make_server
from istilo import create_app
from istilo.db import connect
from istilo.setup import initialize

HARNESS = '''<!doctype html><body><p id="result">RUNNING</p><iframe id="portal" src="/customer/"></iframe>
<script>
const frame=document.getElementById('portal');
const wait=async fn=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('UI timed out');};
frame.onload=async()=>{try{
 const w=frame.contentWindow,d=w.document,$=id=>d.getElementById(id);
 await wait(()=>!!$('customerRegisterForm').onsubmit);
 $('loginButton').click();$('showCustomerRegister').click();
 $('customerRegisterName').value='Browser customer';
 $('customerRegisterEmail').value='browser@example.com';
 $('customerRegisterPhone').value='09171234567';
 $('customerRegisterPassword').value='Browser-Test!123';$('customerTerms').checked=true;
 $('customerRegisterForm').requestSubmit();
 await wait(()=>!$('customerOTPForm').hidden);
 if(w.Istilo.customer)throw Error('Registration authenticated an unverified customer');
 if(!$('customerOTPResend').disabled)throw Error('Missing resend countdown');
 $('customerOTPCode').value='000000';$('customerOTPForm').requestSubmit();
 await wait(()=>$('customerOTPError').textContent.includes('Incorrect'));
 $('customerOTPCode').value='123456';$('customerOTPForm').requestSubmit();
 await wait(()=>$('customerLoginSuccess').textContent.includes('Email verified successfully!'));
 if($('customerLoginForm').hidden)throw Error('Login form not shown after verification');
 $('customerIdentifier').value='browser@example.com';$('customerPassword').value='Browser-Test!123';
 $('customerLoginForm').requestSubmit();await wait(()=>w.Istilo.customer?.verified);
 $('loginButton').click();await wait(()=>!!$('customerProfilePassword'));
 $('customerProfilePassword').click();
 const change=async(password,code)=>{
  $('customerResetIdentifier').value='browser@example.com';
  $('customerResetPassword').value=password;$('customerResetConfirm').value=password;
  $('customerForgotForm').requestSubmit();await wait(()=>d.querySelector('#appConfirmDialog[open]'));
  $('appConfirmYes').click();await wait(()=>!$('customerOTPForm').hidden);
  if(!$('customerOTPTitle').textContent.includes('Password'))throw Error('Missing password OTP screen');
  $('customerOTPCode').value=code;$('customerOTPForm').requestSubmit();
  await wait(()=>$('customerOTPForm').hidden&&!$('customerLoginForm').hidden);
  if(w.Istilo.customer)throw Error('Password change did not return to signed-out login');
 };
 await change('Updated-Test!123','234567');
 $('showForgotPassword').click();await change('Recovered-Test!123','345678');
 $('customerIdentifier').value='browser@example.com';$('customerPassword').value='Recovered-Test!123';
 $('customerLoginForm').requestSubmit();await wait(()=>w.Istilo.customer?.verified);
 document.getElementById('result').textContent='PASS: registration, OTP, profile password update, forgotten password and login';
}catch(e){document.getElementById('result').textContent='FAIL: '+e.message;}};
</script>'''


class OTPBrowserTests(unittest.TestCase):
    def test_customer_registration_in_chrome(self):
        chrome = os.environ.get('CHROME_PATH', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
        if not Path(chrome).is_file():
            self.skipTest('Set CHROME_PATH to run Chrome browser checks')
        database = 'istillo_browser_otp_' + secrets.token_hex(6)
        with tempfile.TemporaryDirectory() as folder:
            app = create_app(dict(TESTING=True, DB_NAME=database, UPLOAD_FOLDER=folder))
            with app.app_context():
                initialize(app)
            app.add_url_rule('/__otp_browser_test', view_func=lambda: Response(HARNESS, mimetype='text/html'))
            # Test harness embeds the portal; production retains frame protection.
            app.after_request_funcs[None].insert(0, lambda response: (response.headers.pop('X-Frame-Options', None), response)[1])
            server = make_server('127.0.0.1', 0, app, threaded=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                with patch('istilo.email_otp.send_code'), patch('istilo.email_otp.secrets.randbelow', side_effect=[123456,234567,345678]):
                    result = subprocess.run([chrome, '--headless=new', '--disable-gpu', '--no-first-run',
                        '--no-default-browser-check', '--user-data-dir='+str(Path(folder)/'chrome'),
                        '--virtual-time-budget=20000', '--dump-dom',
                        f'http://127.0.0.1:{server.server_port}/__otp_browser_test'],
                        capture_output=True, text=True, timeout=45,
                        creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
                self.assertIn('<p id="result">PASS:', result.stdout, (result.stdout + result.stderr)[-5000:])
            finally:
                server.shutdown()
                server.server_close()
                with app.app_context():
                    connection = connect(False)
                    cursor = connection.cursor()
                    assert database.startswith('istillo_browser_otp_')
                    cursor.execute('DROP DATABASE `'+database+'`')
                    cursor.close()
                    connection.close()


if __name__ == '__main__':
    unittest.main()
