import os
import sys
import pandas as pd
from dotenv import load_dotenv
from pinecone import Pinecone, ServerlessSpec
from openai import OpenAI
import json

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), '.env')
load_dotenv(env_path)

pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

INDEX_NAME = "orcamento-engenharia"
NAMESPACE = "composicoes_sinapi"

def recreate_index():
    if INDEX_NAME not in pc.list_indexes().names():
        print(f"Criando índice {INDEX_NAME}...")
        pc.create_index(
            name=INDEX_NAME,
            dimension=1536,
            metric='cosine',
            spec=ServerlessSpec(cloud='aws', region='us-east-1')
        )
    print("Índice pronto.")
    
    try:
        print("Limpando dados antigos no namespace vazio...")
        pc.Index(INDEX_NAME).delete(delete_all=True, namespace="")
    except Exception as e:
        print(f"Aviso durante limpeza: {e}")

def load_data():
    print("Carregando planilhas do SINAPI...")
    base_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'base_sinapi')
    
    df_analitica = pd.read_excel(
        os.path.join(base_path, 'SINAPI_Composicoes_Analiticas.xlsx'), 
        skiprows=9,
        names=['grupo', 'codigo_composicao', 'tipo_item', 'codigo_item', 'descricao', 'unidade', 'coeficiente', 'situacao']
    )
    df_analitica = df_analitica.dropna(subset=['codigo_composicao'])
    df_analitica['codigo_composicao'] = df_analitica['codigo_composicao'].astype(str).str.strip().str.replace('.0', '')
    
    df_precos = pd.read_excel(
        os.path.join(base_path, 'SINAPI_Composicoes_Sem-Desoneracao_RS.xlsx'), 
        skiprows=9,
        names=['grupo', 'codigo_composicao', 'descricao', 'unidade', 'custo']
    )
    df_precos = df_precos.dropna(subset=['codigo_composicao'])
    df_precos['codigo_composicao'] = df_precos['codigo_composicao'].astype(str).str.strip().str.replace('.0', '')
    
    return df_analitica, df_precos

def prepare_documents(df_analitica, df_precos):
    print("Mesclando inteligência e gerando documentos...")
    composicoes = {}
    for _, row in df_analitica.iterrows():
        cod = row['codigo_composicao']
        if cod not in composicoes:
            composicoes[cod] = {
                "codigo": cod,
                "descricao_servico": "Serviço sem descrição",
                "unidade": "",
                "itens": []
            }
        
        # Atualiza a descrição e unidade baseada na linha mestra se encontrada no analitico
        if str(row['tipo_item']).strip().upper() == 'COMPOSIÇÃO' and str(row['codigo_item']).strip() == cod:
            composicoes[cod]["descricao_servico"] = str(row['descricao']).strip()
            composicoes[cod]["unidade"] = str(row['unidade']).strip()
            continue

        if pd.notna(row['codigo_item']) and str(row['codigo_item']).strip() != "":
            composicoes[cod]["itens"].append({
                "codigo_item": str(row['codigo_item']).strip(),
                "descricao": str(row['descricao']).strip(),
                "tipo": str(row['tipo_item']).strip(),
                "unidade": str(row['unidade']).strip(),
                "coeficiente": float(row['coeficiente']) if pd.notna(row['coeficiente']) else 0.0
            })
    
    documents = []
    dict_precos = df_precos.set_index('codigo_composicao').to_dict('index')
    
    for cod, comp in composicoes.items():
        preco_info = dict_precos.get(cod)
        if not preco_info:
            continue
            
        if comp["descricao_servico"] == "Serviço sem descrição":
            comp["descricao_servico"] = str(preco_info["descricao"]).strip()
            comp["unidade"] = str(preco_info["unidade"]).strip()
            
        custo = float(preco_info["custo"]) if pd.notna(preco_info["custo"]) else 0.0
        
        texto_busca = f"SERVIÇO SINAPI: {cod} - {comp['descricao_servico']}\nUnidade: {comp['unidade']}\nCusto Total (Sem Desoneração): R$ {custo:.2f}\n\nITENS DA COMPOSIÇÃO:\n"
        for item in comp["itens"]:
            texto_busca += f"- {item['tipo']}: {item['descricao']} (Cód: {item['codigo_item']}) | Coeficiente: {item['coeficiente']} {item['unidade']}\n"
            
        metadata = {
            "codigo": cod,
            "descricao": comp["descricao_servico"],
            "unidade": comp["unidade"],
            "custo": custo,
            "json_composicao": json.dumps(comp["itens"], ensure_ascii=False)[:30000] # Limite de metadados do Pinecone
        }
        
        documents.append({
            "id": f"comp_{cod}",
            "text": texto_busca,
            "metadata": metadata
        })
        
    return documents

def generate_embeddings_and_upload(documents):
    print(f"Gerando embeddings e subindo para Pinecone ({len(documents)} composições)...")
    index = pc.Index(INDEX_NAME)
    
    batch_size = 50
    for i in range(0, len(documents), batch_size):
        batch = documents[i:i+batch_size]
        texts = [doc["text"] for doc in batch]
        
        res = client.embeddings.create(input=texts, model="text-embedding-3-small")
        
        vectors = []
        for doc, embed in zip(batch, res.data):
            vectors.append({
                "id": doc["id"],
                "values": embed.embedding,
                "metadata": doc["metadata"]
            })
            
        index.upsert(vectors=vectors, namespace=NAMESPACE)
        print(f"Lote {i//batch_size + 1}/{(len(documents)//batch_size)+1} concluído.")
        
    print("SUCESSO: Todas as Composições Analíticas do SINAPI foram indexadas!")

if __name__ == "__main__":
    recreate_index()
    df_a, df_p = load_data()
    docs = prepare_documents(df_a, df_p)
    # Limite removido. O banco inteiro será enviado.
    generate_embeddings_and_upload(docs)
