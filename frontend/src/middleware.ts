import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Intercepta apenas as chamadas que vão para a API Python (backend)
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const requestHeaders = new Headers(request.headers);
    
    // Injeta a chave secreta de forma segura no servidor,
    // sem expor no navegador do cliente (não precisa do NEXT_PUBLIC_)
    const apiKey = process.env.API_SECRET_KEY || process.env.NEXT_PUBLIC_API_KEY || "chave-secreta-padrao";
    
    // Se o frontend já enviou, sobrescreve para garantir que use a segura do servidor se existir
    requestHeaders.set('x-api-key', apiKey);

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }
}

export const config = {
  matcher: '/api/:path*',
};
