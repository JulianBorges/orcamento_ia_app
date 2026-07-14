import os
import pandas as pd
from dotenv import load_dotenv
from openai import OpenAI
from pinecone import Pinecone, ServerlessSpec
from tqdm import tqdm

load_dotenv()

PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
INDEX_NAME = "sinapi-base"
BASE_SINAPI_PATH = os.getenv("BASE_SINAPI_PATH", "../base_sinapi")

def inicializar_pinecone():
    """Conecta ao Pinecone e cria o índice se não existir."""
    if not PINECONE_API_KEY:
        raise ValueError("PINECONE_API_KEY não configurada no .env")
        
    pc = Pinecone(api_key=PINECONE_API_KEY)
    
    if INDEX_NAME not in pc.list_indexes().names():
        print(f"Criando índice '{INDEX_NAME}' no Pinecone...")
        pc.create_index(
            name=INDEX_NAME,
            dimension=1536, # Dimensão do text-embedding-3-small
            metric='cosine',
            spec=ServerlessSpec(cloud='aws', region='us-east-1')
        )
    return pc.Index(INDEX_NAME)

def processar_planilha_sinapi(nome_arquivo):
    """Lê a planilha SINAPI, gera embeddings e salva no Pinecone com Metadados ricos."""
    index = inicializar_pinecone()
    openai_client = OpenAI()

    caminho_arquivo = os.path.join(BASE_SINAPI_PATH, nome_arquivo)
    
    # Pula as 8 linhas de cabeçalho da Caixa Econômica Federal
    df = pd.read_excel(caminho_arquivo, skiprows=9)

    # Busca dinâmica pelas colunas
    col_cod = next((c for c in df.columns if 'código' in str(c).lower() or 'codigo' in str(c).lower()), df.columns[0])
    col_desc = next((c for c in df.columns if 'descri' in str(c).lower()), df.columns[1])
    col_preco = next((c for c in df.columns if 'custo' in str(c).lower() or 'preço' in str(c).lower()), df.columns[2])
    col_und = next((c for c in df.columns if 'unidad' in str(c).lower() or 'und' in str(c).lower()), df.columns[3])

    df = df.rename(columns={col_cod: "Codigo", col_desc: "Descricao", col_preco: "Preco", col_und: "Unidade"})

    # Limpeza de dados
    df = df.dropna(subset=["Codigo", "Descricao"])
    df["Codigo"] = df["Codigo"].astype(str).str.strip()
    df["Descricao"] = df["Descricao"].astype(str).str.strip()
    df["Preco"] = pd.to_numeric(df["Preco"], errors='coerce').fillna(0.0)
    df["Unidade"] = df["Unidade"].astype(str).fillna("-").str.strip()
    
    df = df[(df["Codigo"] != "") & (df["Descricao"] != "")]
    df = df.drop_duplicates(subset=["Codigo"], keep='first')

    total_itens = len(df)
    batch_size = 100 # Reduzido para Pinecone para não exceder limites de requisição
    itens_indexados = 0

    for i in tqdm(range(0, total_itens, batch_size), desc="Vetorizando itens e enviando ao Pinecone"):
        batch_df = df.iloc[i : i + batch_size]
        
        ids = batch_df["Codigo"].tolist()
        documents = batch_df["Descricao"].tolist()
        precos = batch_df["Preco"].tolist()
        unidades = batch_df["Unidade"].tolist()
        
        # Gera Embeddings
        resposta = openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=documents,
        )
        embeddings = [d.embedding for d in resposta.data]

        # Monta os vetores com metadados para o Pinecone
        vectors = []
        for j in range(len(ids)):
            vectors.append({
                "id": ids[j],
                "values": embeddings[j],
                "metadata": {
                    "descricao": documents[j],
                    "preco": precos[j],
                    "unidade": unidades[j]
                }
            })
            
        if vectors:
            index.upsert(vectors=vectors)
        
        itens_indexados += len(ids)

    return itens_indexados

if __name__ == "__main__":
    # Script para ser executado manualmente para inicializar o banco
    arquivo_exemplo = "sinapi_rs.xlsx"
    try:
        total = processar_planilha_sinapi(arquivo_exemplo)
        print(f"\nSucesso! {total} itens indexados no Pinecone com metadados ricos.")
    except Exception as e:
        print(f"Erro: {e}")
