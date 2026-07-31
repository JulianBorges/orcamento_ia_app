import pandas as pd
import asyncio
import os
import asyncpg
import numpy as np
from dotenv import load_dotenv

env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env')
load_dotenv(env_path)

# Variáveis globais para esta carga
ESTADO = "RS"
MODALIDADE = "nao_desonerado"

BASE_SINAPI_PATH = "../base_sinapi"
ARQUIVO_COMPOSICOES = "SINAPI_Composicoes_Sem-Desoneracao_RS.xlsx"
ARQUIVO_INSUMOS = "SINAPI_Insumos_Sem-Desoneracao_RS.xlsx"
ARQUIVO_ANALITICO = "SINAPI_Composicoes_Analiticas.xlsx"

async def seed():
    db_url = os.getenv("SUPABASE_DATABASE_URL")
    if not db_url or db_url.strip() == "" or "your_db_url_here" in db_url:
        raise ValueError("ERRO CRÍTICO: Variável SUPABASE_DATABASE_URL não encontrada ou inválida no arquivo .env!")

    print("--- LENDO PLANILHAS ---")
    
    # 1. Ler Insumos
    path_insumos = os.path.join(BASE_SINAPI_PATH, ARQUIVO_INSUMOS)
    print(f"Lendo Insumos: {path_insumos}")
    df_insumos = pd.read_excel(path_insumos, skiprows=7)
    df_insumos = df_insumos.iloc[1:].copy() # Remove a primeira linha de cabeçalho duplo
    # Colunas esperadas (por índice): 1: Codigo, 2: Descricao, 3: Unidade, 5: Preco
    df_insumos['codigo'] = df_insumos.iloc[:, 1].astype(str).str.strip()
    df_insumos['descricao'] = df_insumos.iloc[:, 2].astype(str).str.strip()
    df_insumos['unidade'] = df_insumos.iloc[:, 3].astype(str).str.strip()
    df_insumos['preco'] = pd.to_numeric(df_insumos.iloc[:, 5].astype(str).str.replace(',', '.'), errors='coerce').fillna(0.0)
    df_insumos = df_insumos[(df_insumos['codigo'] != 'nan') & (df_insumos['codigo'] != '') & (df_insumos['descricao'] != 'nan')]
    df_insumos = df_insumos.drop_duplicates(subset=['codigo'])

    # 2. Ler Composições (Sintético)
    path_composicoes = os.path.join(BASE_SINAPI_PATH, ARQUIVO_COMPOSICOES)
    print(f"Lendo Composições: {path_composicoes}")
    df_comp = pd.read_excel(path_composicoes, skiprows=9)
    # Procurar colunas dinamicamente
    col_cod = next((c for c in df_comp.columns if 'código' in str(c).lower() or 'codigo' in str(c).lower()), df_comp.columns[0])
    col_desc = next((c for c in df_comp.columns if 'descri' in str(c).lower()), df_comp.columns[1])
    col_preco = next((c for c in df_comp.columns if 'custo' in str(c).lower() or 'preço' in str(c).lower()), df_comp.columns[2])
    col_und = next((c for c in df_comp.columns if 'unidad' in str(c).lower() or 'und' in str(c).lower()), df_comp.columns[3])
    
    df_comp = df_comp.rename(columns={col_cod: "codigo", col_desc: "descricao", col_preco: "preco", col_und: "unidade"})
    df_comp = df_comp.dropna(subset=["codigo", "descricao"])
    df_comp["codigo"] = df_comp["codigo"].astype(str).str.strip()
    df_comp["descricao"] = df_comp["descricao"].astype(str).str.strip()
    df_comp["preco"] = pd.to_numeric(df_comp["preco"].astype(str).str.replace(',', '.'), errors='coerce').fillna(0.0)
    df_comp["unidade"] = df_comp["unidade"].astype(str).fillna("-").str.strip()
    df_comp = df_comp[(df_comp["codigo"] != "") & (df_comp["codigo"] != "nan")]
    df_comp = df_comp.drop_duplicates(subset=["codigo"])

    # 3. Ler Analítico
    path_analitico = os.path.join(BASE_SINAPI_PATH, ARQUIVO_ANALITICO)
    print(f"Lendo Analítico: {path_analitico}")
    df_analitica_raw = pd.read_excel(path_analitico, skiprows=6)
    df_analitica_raw = df_analitica_raw.iloc[2:].copy() # Remove lixo no topo
    
    # Indices Analitico: 1=CodComposicao, 2=TipoItem, 3=CodItem, 6=Coeficiente
    df_analitica_raw['codigo_composicao'] = df_analitica_raw.iloc[:, 1].astype(str).str.strip()
    df_analitica_raw['tipo_item'] = df_analitica_raw.iloc[:, 2].astype(str).str.strip()
    df_analitica_raw['codigo_item'] = df_analitica_raw.iloc[:, 3].astype(str).str.strip()
    df_analitica_raw['coeficiente'] = pd.to_numeric(df_analitica_raw.iloc[:, 6].astype(str).str.replace(',', '.'), errors='coerce').fillna(0.0)
    
    # Filtrar apenas linhas que são dependências (onde tipo_item é INSUMO ou COMPOSICAO)
    df_analitica = df_analitica_raw[df_analitica_raw['tipo_item'].isin(['INSUMO', 'COMPOSICAO', 'COMPOSICAO REPRESENTATIVA'])].copy()
    # Normalize tipo_item
    df_analitica.loc[df_analitica['tipo_item'] == 'COMPOSICAO REPRESENTATIVA', 'tipo_item'] = 'COMPOSICAO'
    df_analitica = df_analitica[(df_analitica['codigo_composicao'] != 'nan') & (df_analitica['codigo_item'] != 'nan')]

    print(f"Total Insumos: {len(df_insumos)}")
    print(f"Total Composições: {len(df_comp)}")
    print(f"Total Ligações Analíticas: {len(df_analitica)}")

    print("--- CONECTANDO AO SUPABASE ---")
    conn = await asyncpg.connect(db_url)
    
    print("Recriando tabelas...")
    # Drop antigo (opcional, mas limpa o ambiente para ter certeza)
    await conn.execute('DROP TABLE IF EXISTS sinapi_analitica CASCADE;')
    await conn.execute('DROP TABLE IF EXISTS sinapi_composicoes CASCADE;')
    await conn.execute('DROP TABLE IF EXISTS sinapi_insumos CASCADE;')
    await conn.execute('DROP TABLE IF EXISTS composicoes CASCADE;') # Limpeza da sprint anterior
    
    await conn.execute('''
        CREATE TABLE IF NOT EXISTS budgets (
            id VARCHAR(50) PRIMARY KEY,
            title TEXT,
            data JSONB,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE sinapi_composicoes (
            codigo VARCHAR(50),
            estado VARCHAR(5),
            modalidade VARCHAR(30),
            descricao TEXT,
            preco NUMERIC,
            unidade VARCHAR(20),
            busca_textual tsvector,
            PRIMARY KEY (codigo, estado, modalidade)
        );

        CREATE TABLE sinapi_insumos (
            codigo VARCHAR(50),
            estado VARCHAR(5),
            modalidade VARCHAR(30),
            descricao TEXT,
            preco NUMERIC,
            unidade VARCHAR(20),
            busca_textual tsvector,
            PRIMARY KEY (codigo, estado, modalidade)
        );

        CREATE TABLE sinapi_analitica (
            id SERIAL PRIMARY KEY,
            codigo_composicao VARCHAR(50),
            estado VARCHAR(5),
            modalidade VARCHAR(30),
            tipo_item VARCHAR(20),
            codigo_item VARCHAR(50),
            coeficiente NUMERIC,
            FOREIGN KEY (codigo_composicao, estado, modalidade) REFERENCES sinapi_composicoes (codigo, estado, modalidade) ON DELETE CASCADE
        );
        
        -- Índice B-Tree para consultas rápidas na analítica
        CREATE INDEX idx_analitica_composicao ON sinapi_analitica (codigo_composicao, estado, modalidade);
        CREATE INDEX idx_analitica_item ON sinapi_analitica (codigo_item, estado, modalidade);
    ''')

    # Habilitar RLS em todas as tabelas
    await conn.execute('''
        ALTER TABLE sinapi_composicoes ENABLE ROW LEVEL SECURITY;
        ALTER TABLE sinapi_insumos ENABLE ROW LEVEL SECURITY;
        ALTER TABLE sinapi_analitica ENABLE ROW LEVEL SECURITY;
        ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
        
        -- Políticas de Leitura para tabelas base (livres para leitura pelo app, protegidas para gravação)
        CREATE POLICY select_composicoes ON sinapi_composicoes FOR SELECT USING (true);
        CREATE POLICY select_insumos ON sinapi_insumos FOR SELECT USING (true);
        CREATE POLICY select_analitica ON sinapi_analitica FOR SELECT USING (true);
        
        -- Política temporária permissiva para orçamentos (Será substituída na Sprint de Autenticação)
        CREATE POLICY anon_all_budgets ON budgets FOR ALL USING (true) WITH CHECK (true);
    ''')

    # Triggers FTS para Insumos
    await conn.execute('''
        CREATE OR REPLACE FUNCTION insumos_tsvector_trigger() RETURNS trigger AS $$
        begin
          new.busca_textual := to_tsvector('portuguese', coalesce(new.descricao, ''));
          return new;
        end
        $$ LANGUAGE plpgsql SET search_path = public;

        CREATE TRIGGER tsvectorupdate_insumos BEFORE INSERT OR UPDATE
        ON sinapi_insumos FOR EACH ROW EXECUTE FUNCTION insumos_tsvector_trigger();
        
        CREATE INDEX idx_insumos_fts ON sinapi_insumos USING GIN (busca_textual);
    ''')

    # Triggers FTS para Composicoes
    await conn.execute('''
        CREATE OR REPLACE FUNCTION composicoes_tsvector_trigger() RETURNS trigger AS $$
        begin
          new.busca_textual := to_tsvector('portuguese', coalesce(new.descricao, ''));
          return new;
        end
        $$ LANGUAGE plpgsql SET search_path = public;

        CREATE TRIGGER tsvectorupdate_composicoes BEFORE INSERT OR UPDATE
        ON sinapi_composicoes FOR EACH ROW EXECUTE FUNCTION composicoes_tsvector_trigger();
        
        CREATE INDEX idx_composicoes_fts ON sinapi_composicoes USING GIN (busca_textual);
    ''')

    print("--- INSERINDO DADOS ---")

    # Insumos
    rows_insumos = df_insumos[['codigo', 'descricao', 'preco', 'unidade']].values.tolist()
    pg_insumos = [(str(r[0]), ESTADO, MODALIDADE, str(r[1]), float(r[2]), str(r[3])) for r in rows_insumos]
    await conn.executemany('''
        INSERT INTO sinapi_insumos (codigo, estado, modalidade, descricao, preco, unidade)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (codigo, estado, modalidade) DO NOTHING;
    ''', pg_insumos)
    print("Insumos inseridos.")

    # Composicoes
    rows_comp = df_comp[['codigo', 'descricao', 'preco', 'unidade']].values.tolist()
    pg_comp = [(str(r[0]), ESTADO, MODALIDADE, str(r[1]), float(r[2]), str(r[3])) for r in rows_comp]
    await conn.executemany('''
        INSERT INTO sinapi_composicoes (codigo, estado, modalidade, descricao, preco, unidade)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (codigo, estado, modalidade) DO NOTHING;
    ''', pg_comp)
    print("Composições inseridas.")

    # Analítica
    # Precisamos garantir que a chave estrangeira exista em sinapi_composicoes (pode haver inconsistências na base do SINAPI)
    # Filtramos as linhas onde codigo_composicao existe em df_comp
    valid_codigos = set(df_comp['codigo'].unique())
    df_analitica_valid = df_analitica[df_analitica['codigo_composicao'].isin(valid_codigos)]
    
    rows_ana = df_analitica_valid[['codigo_composicao', 'tipo_item', 'codigo_item', 'coeficiente']].values.tolist()
    pg_ana = [(str(r[0]), ESTADO, MODALIDADE, str(r[1]), str(r[2]), float(r[3])) for r in rows_ana]
    
    # Inserção em lotes menores para evitar estourar a memória se for muito grande
    batch_size = 10000
    for i in range(0, len(pg_ana), batch_size):
        await conn.executemany('''
            INSERT INTO sinapi_analitica (codigo_composicao, estado, modalidade, tipo_item, codigo_item, coeficiente)
            VALUES ($1, $2, $3, $4, $5, $6);
        ''', pg_ana[i:i+batch_size])
    
    print("Tabela Analítica inserida.")

    await conn.execute("NOTIFY pgrst, 'reload schema';")
    await conn.close()
    print("Banco populado com SUCESSO!")

if __name__ == "__main__":
    asyncio.run(seed())
