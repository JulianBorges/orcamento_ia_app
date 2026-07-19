from pydantic import BaseModel, Field
from typing import List, Optional

class AnaliseItem(BaseModel):
    raciocinio_passo_a_passo: str = Field(description="O raciocínio lógico detalhado comparando dimensões, regras de escopo e compatibilidade de unidades ANTES de emitir o veredito.")
    status: str = Field(description="O veredito da análise: 'ACEITO', 'ACEITO COM RESSALVA' ou 'REJEITADO'")
    codigo_selecionado: Optional[str] = Field(None, description="O código SINAPI da opção selecionada. Null se REJEITADO.")
    justificativa: str = Field(description="A justificativa técnica de engenharia para a decisão, incluindo os cálculos de diferença quando aplicável.")

class BatchRequest(BaseModel):
    descriptions: List[str] = Field(description="Lista de descrições legadas para processamento em lote.")

class StatelessBatchItem(BaseModel):
    id: str = Field(description="ID gerado pelo frontend para rastreio do item")
    descricao: str = Field(description="Descrição do item extraída do Excel")
    quantidade: float = Field(default=1.0, description="Quantidade extraída do Excel")
    unidade: Optional[str] = Field(default="", description="Unidade de medida original do legado")
    valorUnit: Optional[float] = Field(default=0.0, description="Valor unitário original do legado")
    is_macro_item: Optional[bool] = Field(default=False, description="Indica se é um título/cabeçalho da EAP")
    macro_etapa_pai: Optional[str] = Field(default="", description="Nome do Cabeçalho que este item pertence")

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
