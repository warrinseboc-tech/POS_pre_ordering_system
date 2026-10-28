import os
from pathlib import Path

from istilo import create_app

app = create_app()

if __name__ == '__main__':
    # Keep the local Windows launcher from starting competing portal servers.
    if os.name == 'nt':
        import msvcrt
        server_lock = (Path(app.instance_path) / ('server-' + os.getenv('PORT','5050') + '.lock')).open('a+b')
        server_lock.seek(0)
        try:
            msvcrt.locking(server_lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise SystemExit('ISTILO is already running on this port. Use the existing server or stop it before restarting.')
    app.run(host=os.getenv('HOST','127.0.0.1'), port=int(os.getenv('PORT','5050')), debug=False)
