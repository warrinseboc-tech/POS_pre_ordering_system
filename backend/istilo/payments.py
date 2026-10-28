import hashlib
import io
import re
import warnings
from pathlib import Path

from flask import Blueprint, abort, current_app, jsonify, request, send_file, session
from PIL import Image, UnidentifiedImageError

from .common import active_shift, require_online_shift, actor, cents, event, now, own_order, payload, require, text, uid
from .db import execute, rows, transaction

payments=Blueprint('payments',__name__)
Image.MAX_IMAGE_PIXELS=12_000_000


@payments.post('/orders/<order_id>/proof')
def upload_proof(order_id):
    upload=request.files.get('proof')
    if not upload: abort(400,description='Choose a PNG, JPEG, or WebP payment receipt.')
    raw=upload.read(5*1024*1024+1)
    if not raw or len(raw)>5*1024*1024: abort(413,description='The receipt must be smaller than 5 MB.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error',Image.DecompressionBombWarning)
            image=Image.open(io.BytesIO(raw))
            if image.format not in ('PNG','JPEG','WEBP') or min(image.size)<100: raise ValueError()
            image.verify()
            image=Image.open(io.BytesIO(raw))
            image.load()
            # Re-encode pixels only; discard metadata, scripts, and original filename.
            clean=image.convert('RGB')
            clean.thumbnail((2400,2400))
            output=io.BytesIO(); clean.save(output,'JPEG',quality=90)
    except (UnidentifiedImageError,ValueError,OSError,Image.DecompressionBombError,Image.DecompressionBombWarning):
        abort(400,description='Upload a readable PNG, JPEG, or WebP image, at least 100×100 pixels and no more than 12 megapixels.')
    reference=text(request.form.get('reference',''),80,True).upper()
    if not re.fullmatch(r'[A-Z0-9-]{8,80}',reference): abort(400,description='Enter the full GCash/Maya transaction reference (8–80 letters or digits).')
    amount=cents(request.form.get('amount'),True)
    proof_id=uid('PROOF'); filename=proof_id+'.jpg'
    target=Path(current_app.config['UPLOAD_FOLDER'])/filename
    try:
        with transaction():
            order=rows('SELECT * FROM orders WHERE id=%s FOR UPDATE',(order_id,),one=True)
            own_order(order)
            if order['source']!='Customer' or order['status']!='Pending' or order['payment_status'] not in ('Awaiting proof','Rejected'):
                abort(409,description='This order already has a pending/approved payment or is no longer active.')
            if amount!=order['total_cents']: abort(400,description='The transferred amount must match the order total.')
            if rows('SELECT COUNT(*) AS count FROM payment_proofs WHERE order_id=%s',(order_id,),one=True)['count']>=5:
                abort(429,description='Too many rejected submissions. Contact the shop.')
            claim=rows('SELECT order_id FROM payment_references WHERE wallet=%s AND reference_number=%s FOR UPDATE',(order['payment_method'],reference),one=True)
            if claim and claim['order_id']!=order_id: abort(409,description='This transaction reference is already assigned to another order.')
            if not claim:
                execute('INSERT INTO payment_references(wallet,reference_number,order_id) VALUES(%s,%s,%s)',(order['payment_method'],reference,order_id))
            target.write_bytes(output.getvalue())
            execute('INSERT INTO payment_proofs(id,order_id,reference_number,wallet,amount_cents,original_hash,storage_name,mime_type) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)',(proof_id,order_id,reference,order['payment_method'],amount,hashlib.sha256(raw).hexdigest(),filename,'image/jpeg'))
            execute("UPDATE orders SET payment_status='Under review',updated_at=%s WHERE id=%s",(now(),order_id))
            event(order_id,'proof_uploaded','Payment receipt submitted for crew verification')
    except Exception:
        target.unlink(missing_ok=True)
        raise
    return jsonify(ok=True,proofId=proof_id),201


@payments.get('/payments/proofs/<proof_id>/image')
def proof_image(proof_id):
    proof=rows('SELECT * FROM payment_proofs WHERE id=%s',(proof_id,),one=True)
    if not proof: abort(404)
    order=rows('SELECT * FROM orders WHERE id=%s',(proof['order_id'],),one=True)
    reviewer=rows("SELECT id FROM users WHERE id=%s AND role='crew' AND active=1",(session.get('crew_id',''),),one=True)
    reviewer = reviewer and active_shift(dict(id=reviewer['id'],role='crew'))
    if not reviewer and order['customer_token'] != session.get('customer_token'):
        abort(403 if session.get('admin_id') else 404)
    file=Path(current_app.config['UPLOAD_FOLDER'])/proof['storage_name']
    if not file.is_file(): abort(404)
    response=send_file(file,mimetype='image/jpeg',download_name='payment-receipt.jpg')
    response.headers['Cache-Control']='no-store'
    return response


@payments.post('/payments/proofs/<proof_id>/review')
@require('crew')
def review(proof_id):
    data=payload()
    decision=data.get('decision')
    if decision not in ('approve','reject'): abort(400)
    # Lock order before proof, matching the upload lock order.
    preliminary=rows('SELECT order_id FROM payment_proofs WHERE id=%s',(proof_id,),one=True)
    if not preliminary: abort(404)
    with transaction():
        order=rows('SELECT * FROM orders WHERE id=%s FOR UPDATE',(preliminary['order_id'],),one=True)
        require_online_shift(order)
        proof=rows('SELECT * FROM payment_proofs WHERE id=%s FOR UPDATE',(proof_id,),one=True)
        if proof['status']!='Under review' or order['payment_status']!='Under review' or order['status']!='Pending':
            abort(409,description='This payment has already been reviewed or the order has changed.')
        note=text(data.get('note',''),500,decision=='reject')
        if decision=='approve':
            if data.get('confirmedReceived') is not True: abort(400,description='Confirm receipt of the transfer in the receiving wallet transaction history.')
            if text(data.get('reference',''),80,True).upper()!=proof['reference_number']: abort(400,description='The confirmed wallet reference does not match the proof.')
            if cents(data.get('receivedAmount'),True)!=order['total_cents']: abort(400,description='The amount actually received must match the order total.')
            execute("UPDATE payment_proofs SET status='Approved',review_note=%s,reviewed_at=%s,reviewed_by=%s WHERE id=%s",(note,now(),actor()['id'],proof_id))
            execute("UPDATE orders SET payment_status='Verified',released_at=%s,collected_at=%s,collected_by=%s,cash_received_cents=total_cents,updated_at=%s WHERE id=%s",(now(),now(),actor()['id'],now(),order['id']))
            event(order['id'],'payment_verified','Transfer confirmed and proof approved; released to crew',actor()['id'])
        else:
            execute("UPDATE payment_proofs SET status='Rejected',review_note=%s,reviewed_at=%s,reviewed_by=%s WHERE id=%s",(note,now(),actor()['id'],proof_id))
            execute("UPDATE orders SET payment_status='Rejected',updated_at=%s WHERE id=%s",(now(),order['id']))
            event(order['id'],'payment_rejected',note,actor()['id'])
    return jsonify(ok=True)
