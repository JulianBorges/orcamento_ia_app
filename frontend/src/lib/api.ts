import axios from 'axios';

// A URL base aponta para o backend FastAPI.
// Em produção na Vercel, isso será substituído pela URL correta via variáveis de ambiente.
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.NEXT_PUBLIC_API_KEY || 'chave-secreta-padrao'
  },
});

export default api;
