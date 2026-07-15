from pydantic import BaseModel, Field
from typing import List, Optional

class AnaliseItem(BaseModel):
    status: str = Field(description="O veredito da análise: 'ACEITO', 'ACEITO COM RESSALVA' ou 'REJEITADO'")
    codigo_selecionado: Optional[str] = Field(None, description="O código SINAPI da opção selecionada. Null se REJEITADO.")
    justificativa: str = Field(description="A justificativa técnica de engenharia para a decisão, incluindo os cálculos de diferença quando aplicável.")

class BatchRequest(BaseModel):
    descriptions: List[str] = Field(description="Lista de descrições legadas para processamento em lote.")

class StatelessBatchItem(BaseModel):
    id: str = Field(description="ID gerado pelo frontend para rastreio do item")
    descricao: str = Field(description="Descrição do item extraída do Excel")
    quantidade: float = Field(default=1.0, description="Quantidade extraída do Excel")

class StatelessBatchRequest(BaseModel):
    itens: List[StatelessBatchItem] = Field(description="Lista de itens em lote (chunk) enviados pelo frontend")

class ComposicaoRequest(BaseModel):
    servico: str = Field(description="Descrição do serviço para gerar uma composição.")

class ComposicaoItem(BaseModel):
    codigo_sinapi: str
    descricao: str
    tipo: str = Field(description="'Material', 'Mão de Obra' ou 'Equipamento'")
    unidade: str
    coeficiente: float
    valor_unitario: float
    valor_total: float

class ComposicaoGerada(BaseModel):
    servico: str
    unidade_medida: str
    itens: List[ComposicaoItem]
    valor_total_composicao: float
    justificativa: str = Field(description="Explicação técnica sobre as produtividades e coeficientes adotados.")
