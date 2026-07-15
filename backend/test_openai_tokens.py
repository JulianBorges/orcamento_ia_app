import os
import asyncio
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()
client = AsyncOpenAI()

async def test_tokens():
    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": "hello"}],
            max_tokens=10,
        )
        print("Success:", response.usage)
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    asyncio.run(test_tokens())
