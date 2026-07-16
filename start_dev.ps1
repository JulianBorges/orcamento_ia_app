Write-Host "Iniciando o Ambiente de Testes Local (Frontend + Backend)..." -ForegroundColor Cyan
Start-Process cmd -ArgumentList "/k", "cd backend && uvicorn main:app --reload"
Start-Process cmd -ArgumentList "/k", "cd frontend && npm run dev"
Write-Host "Ambiente iniciado com sucesso em duas novas janelas!" -ForegroundColor Yellow
Write-Host "Acesse o app em http://localhost:3000"
