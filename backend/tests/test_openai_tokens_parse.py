import os
import asyncio
from openai import AsyncOpenAI
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()
client = AsyncOpenAI()

class TestResponse(BaseModel):
    message: str

async def test_tokens():
    try:
        response = await client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": "say hello"}],
            response_format=TestResponse,
            max_tokens=50,
        )
        print("Success:", response.usage)
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    asyncio.run(test_tokens())
