import pandas as pd
import sqlite3
import os

BASE_SINAPI_PATH = "../base_sinapi"
NOME_ARQUIVO = "SINAPI_Composicoes_Sem-Desoneracao_RS.xlsx"

caminho_arquivo = os.path.join(BASE_SINAPI_PATH, NOME_ARQUIVO)

print("Lendo a planilha...")
# Pula as linhas de cabeçalho
df = pd.read_excel(caminho_arquivo, skiprows=9)

col_cod = next((c for c in df.columns if 'código' in str(c).lower() or 'codigo' in str(c).lower()), df.columns[0])
col_desc = next((c for c in df.columns if 'descri' in str(c).lower()), df.columns[1])
col_preco = next((c for c in df.columns if 'custo' in str(c).lower() or 'preço' in str(c).lower()), df.columns[2])
col_und = next((c for c in df.columns if 'unidad' in str(c).lower() or 'und' in str(c).lower()), df.columns[3])

df = df.rename(columns={col_cod: "Codigo", col_desc: "Descricao", col_preco: "Preco", col_und: "Unidade"})
df = df.dropna(subset=["Codigo", "Descricao"])
df["Codigo"] = df["Codigo"].astype(str).str.strip()
df["Descricao"] = df["Descricao"].astype(str).str.strip()
df["Preco"] = pd.to_numeric(df["Preco"], errors='coerce').fillna(0.0)
df["Unidade"] = df["Unidade"].astype(str).fillna("-").str.strip()
df = df[(df["Codigo"] != "") & (df["Descricao"] != "")]
df = df.drop_duplicates(subset=["Codigo"], keep='first')

print(f"Total de itens válidos encontrados na planilha: {len(df)}")

db_path = "sinapi.db"
if os.path.exists(db_path):
    os.remove(db_path)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("Criando banco FTS5 (Busca ultra-rápida sem acentos)...")
cursor.execute('''
    CREATE VIRTUAL TABLE composicoes USING fts5(
        codigo, 
        descricao, 
        preco UNINDEXED, 
        unidade UNINDEXED,
        tokenize="unicode61 remove_diacritics 1"
    )
''')

rows = df[["Codigo", "Descricao", "Preco", "Unidade"]].values.tolist()
cursor.executemany('''
    INSERT INTO composicoes(codigo, descricao, preco, unidade)
    VALUES(?, ?, ?, ?)
''', rows)

conn.commit()
conn.close()

print(f"Banco de dados criado com sucesso em {db_path}!")
