import os
import chromadb
import pandas as pd
from dotenv import load_dotenv
from openai import OpenAI
from tqdm import tqdm

load_dotenv()

CHROMA_PATH = "chroma_data"
COLLECTION_NAME = "sinapi_base"
BASE_SINAPI_PATH = os.getenv("BASE_SINAPI_PATH", "./base_sinapi")

def inicializar_banco():
    """Configura o ChromaDB local e retorna a coleção sinapi_base."""
    client = chromadb.PersistentClient(path=CHROMA_PATH)
    collection = client.get_or_create_collection(name=COLLECTION_NAME)
    return collection

def processar_planilha_sinapi(nome_arquivo):
    """Lê a planilha SINAPI, gera embeddings em lote e persiste no ChromaDB."""
    collection = inicializar_banco()
    openai_client = OpenAI()

    caminho_arquivo = os.path.join(BASE_SINAPI_PATH, nome_arquivo)
    
    # Pula as 8 linhas de cabeçalho da Caixa Econômica Federal
    df = pd.read_excel(caminho_arquivo, skiprows=9)

    # Busca dinâmica e inteligente pelas colunas (ignora posições que mudam)
    try:
        col_codigo = [col for col in df.columns if 'código' in str(col).lower() or 'codigo' in str(col).lower()][0]
        col_descricao = [col for col in df.columns if 'descrição' in str(col).lower() or 'descricao' in str(col).lower()][0]
    except IndexError:
        raise ValueError("Não foi possível encontrar as colunas de Código e Descrição no cabeçalho.")

    df = df.rename(columns={col_codigo: "Codigo", col_descricao: "Descricao"})

    # Limpeza de dados (Data Cleaning)
    df = df.dropna(subset=["Codigo", "Descricao"])
    df["Codigo"] = df["Codigo"].astype(str).str.strip()
    df["Descricao"] = df["Descricao"].astype(str).str.strip()
    
    # Barreira de Segurança 1: Remove linhas vazias
    df = df[(df["Codigo"] != "") & (df["Descricao"] != "")]
    
    # Barreira de Segurança 2: Força a remoção de IDs duplicados da Caixa
    df = df.drop_duplicates(subset=["Codigo"], keep='first')

    total_itens = len(df)
    batch_size = 500
    itens_indexados = 0

    # Processamento em lotes (batches) com barra de progresso visual
    for i in tqdm(range(0, total_itens, batch_size), desc="Vetorizando itens do SINAPI"):
        batch_df = df.iloc[i : i + batch_size]
        
        ids = batch_df["Codigo"].tolist()
        documents = batch_df["Descricao"].tolist()
        
        # Envia todas as descrições do lote de uma vez para a OpenAI
        resposta = openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=documents,
        )
        
        embeddings = [d.embedding for d in resposta.data]

        # Salva o lote processado no banco de dados local
        if ids:
            collection.upsert(
                ids=ids,
                documents=documents,
                embeddings=embeddings,
            )
        
        itens_indexados += len(ids)

    return itens_indexados

if __name__ == "__main__":
    arquivo_exemplo = "sinapi_rs.xlsx"
    print(f"Processando planilha: {arquivo_exemplo}")

    try:
        total = processar_planilha_sinapi(arquivo_exemplo)
        print(f"\nConcluído: {total} itens indexados na coleção '{COLLECTION_NAME}'.")
    except FileNotFoundError:
        print(
            f"Arquivo não encontrado em '{BASE_SINAPI_PATH}/{arquivo_exemplo}'. "
            "Verifique se a planilha está na pasta correta e com a extensão .xlsx"
        )
    except Exception as erro:
        print(f"Erro durante o processamento: {erro}")