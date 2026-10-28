"""Disposable database/server for browser tests; never touches the live portal DB."""
import os
import secrets
import sys
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from PIL import Image, ImageDraw
from flask import abort, request
from werkzeug.security import generate_password_hash
from werkzeug.serving import make_server
from istilo import ROOT, create_app
from istilo.db import connect, execute, transaction
from istilo.setup import initialize

database='istillo_browser_'+secrets.token_hex(6)
folder=ROOT/'.tmp'/'browser-proofs'
app=create_app(dict(DB_NAME=database,UPLOAD_FOLDER=str(folder),TESTING=True))
with app.app_context():
    initialize(app)
    with transaction():
        for role in ('admin','crew'):
            execute('INSERT INTO users(id,employee_id,name,email,password_hash,role) VALUES(%s,%s,%s,%s,%s,%s)',(role,role.upper()+'001',role.title(),'',generate_password_hash('Browser-Test-Password!'),role))
image=Image.new('RGB',(440,620),'white')
ImageDraw.Draw(image).text((30,40),'TEST RECEIPT - NOT A REAL PAYMENT\n'+secrets.token_hex(16),fill='black')
image.save(ROOT/'.tmp'/'browser-receipt.png')
stop=False


@app.post('/__test_shutdown')
def shutdown():
    global stop
    if request.headers.get('X-Test-Token')!=os.environ.get('BROWSER_TEST_TOKEN'): abort(403)
    stop=True
    return {'ok':True}


server=make_server('127.0.0.1',0,app)
print('READY '+str(server.server_port),flush=True)
try:
    while not stop: server.handle_request()
finally:
    server.server_close()
    with app.app_context():
        connection=connect(False);cursor=connection.cursor()
        assert database.startswith('istillo_browser_')
        cursor.execute('DROP DATABASE `'+database+'`');cursor.close();connection.close()
