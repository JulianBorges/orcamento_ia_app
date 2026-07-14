import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from main import app

# Export the FastAPI app for Vercel
