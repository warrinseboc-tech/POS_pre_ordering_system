import os
from threading import Lock

import mysql.connector
from mysql.connector import pooling
from dotenv import load_dotenv

# Reads the .env file next to this script (see .env.example)
load_dotenv()

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("DB_PORT", "3306")),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASSWORD", ""),
    "database": os.getenv("DB_NAME", "istillo_db"),
    "charset": "utf8mb4",
    "use_unicode": True,
}

_pool = None
_pool_lock = Lock()


def get_connection():
    """Return a connection from a small pool.

    Your routes already call conn.close() when done; with a pool, close()
    hands the connection back instead of tearing it down, so no route
    code needs to change.
    """
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = pooling.MySQLConnectionPool(
                    pool_name="istillo_pool",
                    pool_size=5,
                    pool_reset_session=True,
                    **DB_CONFIG,
                )
    return _pool.get_connection()
