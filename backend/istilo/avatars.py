"""Account-owned profile pictures, persisted with the application's database."""
import base64
import io
import warnings

from flask import Blueprint, abort, jsonify, request, send_file, session
from PIL import Image, UnidentifiedImageError

from .common import actor
from .db import execute, rows, transaction

avatars = Blueprint('avatars', __name__)


def identity():
    if request.headers.get('X-Portal') == 'crew':
        user = actor()
        if user and user['role'] == 'crew':
            return 'crew:' + str(user['id'])
    elif session.get('customer_id') and session.get('customer_verified'):
        return 'customer:' + str(session['customer_id'])
    abort(401, description='Sign in to manage your profile picture.')


@avatars.route('/profile-picture', methods=['GET', 'POST'])
def picture():
    account = identity()
    encoded = None
    if request.method == 'POST':
        upload = request.files.get('image')
        if not upload:
            abort(400, description='Choose a profile picture.')
        raw = upload.read(5 * 1024 * 1024 + 1)
        if len(raw) > 5 * 1024 * 1024:
            abort(413, description='Profile pictures must be smaller than 5 MB.')
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error', Image.DecompressionBombWarning)
                image = Image.open(io.BytesIO(raw))
                if image.format not in ('JPEG', 'PNG', 'WEBP') or image.width * image.height > 12_000_000:
                    raise ValueError()
                from PIL import ImageOps
                image = ImageOps.exif_transpose(image)
                image = ImageOps.fit(image.convert('RGB'), (256, 256))
                output = io.BytesIO()
                image.save(output, 'JPEG', quality=85)
                encoded = base64.b64encode(output.getvalue()).decode('ascii')
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            abort(400, description='Choose a readable JPG, PNG, or WebP picture under 12 megapixels.')
    with transaction():
        execute('''CREATE TABLE IF NOT EXISTS profile_pictures (
            account_key VARCHAR(150) PRIMARY KEY, image_data TEXT NOT NULL)''')
        if encoded:
            execute('DELETE FROM profile_pictures WHERE account_key=%s', (account,))
            execute('INSERT INTO profile_pictures(account_key,image_data) VALUES(%s,%s)', (account, encoded))
        saved = rows('SELECT image_data FROM profile_pictures WHERE account_key=%s', (account,), one=True)
    if request.method == 'POST':
        return jsonify(ok=True)
    if not saved:
        abort(404, description='No profile picture yet.')
    return send_file(io.BytesIO(base64.b64decode(saved['image_data'])), mimetype='image/jpeg')
