import sys
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent.parent / 'backend'
sys.path.insert(0, str(backend_path))

# Import and configure the FastAPI app
from main import app

# Ensure the app is exported for Vercel's ASGI handler
__all__ = ['app']
