import os
import io
import chromadb
import pandas as pd
import streamlit as st
from dotenv import load_dotenv
from openai import OpenAI

# Carrega as variáveis de ambiente do arquivo .env
load_dotenv()

# Configuração da página - Setup Front-end
st.set_page_config(
    page_title="Copiloto de Engenharia",
    layout="wide",
)

st.title("Copiloto para Engenharia de Custos")
st.markdown("Sistema de Atualização e Validação de Orçamentos Públicos")

# Menu lateral simulado
with st.sidebar:
    st.header("Navegação")
    st.info("Utilize as abas principais no centro da tela para acessar as funcionalidades.")
    st.divider()
    st.subheader("Status do Motor IA - OpenAI")
    if st.button("Testar Conexão (OpenAI)"):
        try:
            client = OpenAI() 
            with st.spinner("Conectando ao servidor..."):
                resposta = client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "user", "content": "Aja como um assistente de engenharia. Responda apenas: 'Conexão estabelecida com sucesso! Canteiro de obras digital pronto para operar.' e nada mais."}
                    ]
                )
            st.success(resposta.choices[0].message.content)
        except Exception as e:
            st.error(f"Erro de conexão. Verifique sua chave no .env. Detalhes: {e}")

# O Prompt Multidisciplinar Mestre
#SYSTEM_PROMPT_ENGENHARIA = (
#    "Você é um Engenheiro Sênior Multidisciplinar (Engenharia Civil, Mecânica, Arquitetura e Urbanismo, "
#    "com foco em Estruturas, Geotecnia, Instalações Hidrossanitárias/Elétricas, PPCI, Climatização, Elevadores e Outros). "
#    "O seu trabalho é compatibilizar descrições de orçamentos legados com a base oficial do SINAPI.\n"
#    "Você sabe que nomenclaturas de projetos antigos raramente são idênticas ao SINAPI. Avalie a INTENÇÃO TÉCNICA "
#    "e a FUNÇÃO do elemento no projeto.\n"
#    "Regra 1 (CÓDIGO ACEITO): Se a opção do SINAPI atende à função técnica, material principal e ordem de grandeza "
#    "(mesmo com palavras diferentes), aprove. Inicie OBRIGATORIAMENTE com 'CÓDIGO ACEITO:' e explique tecnicamente a equivalência.\n"
#    "Regra 2 (CÓDIGO ACEITO COM PREMISSA): Se o legado for genérico (falta aplicação específica) ou tiver uma "
#    "diferença menor que não altera a finalidade (ex: brita vs cimento para sub-base), escolha a melhor opção, "
#    "inicie OBRIGATORIAMENTE com 'CÓDIGO ACEITO COM PREMISSA:' e justifique a premissa de engenharia adotada.\n"
#    "Regra 3 (CÓDIGO REJEITADO): Rejeite sumariamente se houver incompatibilidade física ou de norma "
#    "(ex: fck menor, diâmetros diferentes, equipamento vs manual). Inicie OBRIGATORIAMENTE com 'CÓDIGO REJEITADO:' e aponte a falha técnica."
#)

SYSTEM_PROMPT_ENGENHARIA = (
    "Você é um Engenheiro Sênior Multidisciplinar (Engenharia Civil, Mecânica, Arquitetura e Urbanismo, "
    "com foco em Estruturas, Geotecnia, Instalações Hidrossanitárias/Elétricas, PPCI, Climatização, Elevadores e Outros). "
    "Sua tarefa é mapear descrições de orçamentos legados para a base oficial do SINAPI, utilizando as seguintes Regras Críticas de Aprovação:\n\n"
    "REGRA 1: TOLERÂNCIA DE ESCOPO (Macro vs. Micro)\n"
    "Avalie a ordem de grandeza e a etapa da obra. É ESTRITAMENTE PROIBIDO associar um serviço global/sistêmico "
    "(ex: 'Instalação provisória', 'Mobilização', 'Rede de água', 'Canteiro') a uma peça micro/unitária ou conexão "
    "(ex: 'um Tê', 'uma bucha', 'um cabo', 'um disjuntor'). Incompatibilidade de escala e esforço exige REJEIÇÃO imediata.\n\n"
    "REGRA 2: TOLERÂNCIA FÍSICA E DIMENSIONAL (Limite de 20%)\n"
    "Se a descrição legada exigir uma dimensão específica (mm, cm, m, kg, etc.), compare com as dimensões das opções do SINAPI. "
    "Calcule a diferença percentual de forma estrita. Se a variação da grandeza for SUPERIOR a 20%, REJEITE a opção por incompatibilidade física. "
    "Se a variação for de até 20%, a opção é aceitável como premissa, mas você DEVE exibir o cálculo percentual na sua justificativa.\n\n"
    "REGRA 3: CLASSIFICAÇÃO DA RESPOSTA\n"
    "- Se houver correspondência exata ou equivalência plena de função técnica: Inicie com 'CÓDIGO ACEITO:' e justifique.\n"
    "- Se houver diferença aceitável (dentro da tolerância de 20% ou premissa de uso similar): Inicie com 'CÓDIGO ACEITO COM PREMISSA:' e justifique mostrando a lógica/cálculo.\n"
    "- Se quebrar as regras de Escopo (Regra 1) ou de Dimensão física >20% (Regra 2): Inicie OBRIGATORIAMENTE com 'CÓDIGO REJEITADO:' e explique a violação."
)

# Estrutura das 3 abas principais
aba_mapeamento, aba_cpus, aba_bdi = st.tabs([
    "Mapeamento Inteligente",
    "Gerador de CPUs",
    "Validador de BDI (TCU)"
])

with aba_mapeamento:
    st.subheader("Mapeamento Semântico Inteligente")
    st.write("Módulo para cruzamento automático de descrições legadas com bases oficiais (SINAPI).")

    # Seletor de Modo de Operação
    modo_processamento = st.radio(
        "Selecione o modo de processamento:",
        ["Individual (Teste Rápido)", "Em Lote (Upload de Planilha)"],
        horizontal=True
    )
    
    st.divider()

    if modo_processamento == "Individual (Teste Rápido)":
        descricao_legada = st.text_area(
            "Descrição legada do orçamento",
            placeholder='Ex.: "Central de Ar Condicionado VRF" ou "Concreto fck=30MPa"',
            height=100,
        )

        if st.button("Buscar Correspondência", type="primary"):
            if not descricao_legada.strip():
                st.warning("Digite uma descrição para buscar correspondências.")
            else:
                try:
                    with st.spinner("Buscando correspondências na base SINAPI..."):
                        openai_client = OpenAI()
                        resposta = openai_client.embeddings.create(
                            model="text-embedding-3-small",
                            input=descricao_legada.strip(),
                        )
                        query_embedding = resposta.data[0].embedding

                        chroma_client = chromadb.PersistentClient(path="chroma_data")
                        collection = chroma_client.get_or_create_collection(name="sinapi_base")

                        resultados = collection.query(
                            query_embeddings=[query_embedding],
                            n_results=15,
                            include=["documents", "distances"],
                        )

                    ids = resultados["ids"][0]
                    documentos = resultados["documents"][0]
                    distancias = resultados["distances"][0]

                    st.success(f"Top 10 correspondências encontradas para: **{descricao_legada.strip()}**")

                    df_resultados = pd.DataFrame({
                        "Rank": range(1, len(ids) + 1),
                        "Código SINAPI": ids,
                        "Descrição": documentos,
                        "Distância": [round(d, 4) for d in distancias],
                    })
                    st.dataframe(df_resultados, use_container_width=True, hide_index=True)

                    st.subheader("Parecer Técnico do Assistente (IA)")
                    
                    melhor_distancia = distancias[0]
                    
                    # Filtro Matemático (Nota de Corte)
                    if melhor_distancia > 0.80:
                        parecer_texto = (
                            f"CÓDIGO REJEITADO: Bloqueio por Filtro Matemático. A distância vetorial da melhor "
                            f"opção ({melhor_distancia:.4f}) é superior ao limite aceitável de 0.80. "
                            "Isso indica que o banco do SINAPI não possui correspondência viável para este item."
                        )
                        st.error(parecer_texto)
                    else:
                        resultados_sinapi = "\n".join(
                            f"{rank}. Código: {codigo} | Descrição: {descricao} | Distância: {distancia:.4f}"
                            for rank, codigo, descricao, distancia in zip(range(1, len(ids) + 1), ids, documentos, distancias)
                        )

                        with st.spinner("Analisando correspondências e gerando parecer técnico..."):
                            parecer = openai_client.chat.completions.create(
                                model="gpt-4o-mini",
                                messages=[
                                    {"role": "system", "content": SYSTEM_PROMPT_ENGENHARIA},
                                    {"role": "user", "content": f"Descrição legada:\n{descricao_legada.strip()}\n\nTop 10 resultados SINAPI:\n{resultados_sinapi}\n\nSelecione o código mais apropriado e justifique de acordo com suas regras."}
                                ],
                            )

                        parecer_texto = parecer.choices[0].message.content

                        if parecer_texto.startswith("CÓDIGO REJEITADO:"):
                            st.error(parecer_texto)
                        elif parecer_texto.startswith("CÓDIGO ACEITO COM PREMISSA:"):
                            st.warning(parecer_texto)
                        else:
                            st.success(parecer_texto)

                except Exception as e:
                    st.error(f"Erro ao buscar correspondências. Detalhes: {e}")

    else:
        # ==========================================================
        # MODO EM LOTE - WORKSPACE COM BUSCA REATIVA E PROGRESS BAR
        # ==========================================================
        
        def recalcular_eap(df):
            major = 0
            minor = 0
            nova_numeracao = []
            for index, row in df.iterrows():
                if row['Status'] == '🔷':
                    major += 1
                    minor = 0
                    nova_numeracao.append(f"{major}.0")
                else:
                    if major == 0: major = 1 
                    minor += 1
                    nova_numeracao.append(f"{major}.{minor}")
            df['Item'] = nova_numeracao
            return df

        if "orcamento_processado" not in st.session_state:
            st.session_state["orcamento_processado"] = None

        # 1. TELA DE IMPORTAÇÃO
        if st.session_state["orcamento_processado"] is None:
            st.markdown("### ⚙️ Configuração e Importação")
            st.caption("Faça o upload da planilha base para iniciar o mapeamento automatizado.")
            
            arquivo_upload = st.file_uploader("Arraste ou selecione a Planilha (.xlsx, .xls)", type=["xlsx", "xls"])
            
            if arquivo_upload is not None:
                df_legado_temp = pd.read_excel(arquivo_upload)
                
                col1, col2, col3 = st.columns(3)
                with col1:
                    coluna_descricao = st.selectbox("Coluna: Descrição", options=df_legado_temp.columns)
                with col2:
                    coluna_quant = st.selectbox("Coluna: Quantidade", options=df_legado_temp.columns)
                with col3:
                    taxa_bdi = st.number_input("Taxa de BDI (%)", min_value=0.0, max_value=100.0, value=21.58, step=0.01)
                
                if st.button("Processar Orçamento", type="primary", use_container_width=True):
                    try:
                        caminho_sinapi = os.path.join(os.getenv("BASE_SINAPI_PATH", "./base_sinapi"), "sinapi_rs.xlsx")
                        df_sinapi_precos = pd.read_excel(caminho_sinapi, skiprows=9)
                        df_sinapi_precos['Código da\nComposição'] = df_sinapi_precos['Código da\nComposição'].astype(str).str.strip()
                        dict_precos = dict(zip(df_sinapi_precos['Código da\nComposição'], pd.to_numeric(df_sinapi_precos['Custo (R$)'], errors='coerce')))
                        dict_unidades = dict(zip(df_sinapi_precos['Código da\nComposição'], df_sinapi_precos['Unidade']))

                        openai_client = OpenAI()
                        chroma_client = chromadb.PersistentClient(path="chroma_data")
                        collection = chroma_client.get_or_create_collection(name="sinapi_base")
                        
                        linhas_orcamento = []
                        df_legado = df_legado_temp.copy()
                        total_linhas = len(df_legado)
                        
                        # Barra de Progresso Restaurada
                        st.markdown("---")
                        texto_status = st.empty()
                        barra_progresso = st.progress(0)
                        
                        for indice, linha in df_legado.iterrows():
                            descricao_alvo = str(linha[coluna_descricao]).strip()
                            texto_status.text(f"Processando linha {indice + 1} de {total_linhas}: {descricao_alvo[:50]}...")
                            
                            if not descricao_alvo or str(descricao_alvo).lower() == "nan": 
                                barra_progresso.progress((indice + 1) / total_linhas)
                                continue
                                
                            quant_bruta = linha[coluna_quant]
                            quant_alvo = pd.to_numeric(quant_bruta, errors='coerce')
                            
                            if pd.isna(quant_alvo) or quant_alvo == 0.0:
                                linhas_orcamento.append({
                                    "Item": "", 
                                    "Código": "",
                                    "Base": "-",
                                    "Descrição": descricao_alvo.upper(),
                                    "Und": "-",
                                    "Quant.": 0.0,
                                    "Valor Unit": 0.0,
                                    "Valor c/ BDI": 0.0,
                                    "Total": 0.0,
                                    "Parecer Técnico": "Identificado automaticamente como Título/Etapa.",
                                    "Status": "🔷"
                                })
                                barra_progresso.progress((indice + 1) / total_linhas)
                                continue
                            
                            resposta_emb = openai_client.embeddings.create(model="text-embedding-3-small", input=descricao_alvo)
                            resultados_busca = collection.query(query_embeddings=[resposta_emb.data[0].embedding], n_results=15, include=["documents", "distances"])
                            ids = resultados_busca["ids"][0]
                            documentos = resultados_busca["documents"][0]
                            
                            codigo_escolhido, descricao_escolhida, parecer_texto = "", "", ""
                            
                            if resultados_busca["distances"][0][0] > 0.80:
                                icone_status = "🔴"
                                parecer_texto = "Rejeitado pelo Filtro Matemático."
                            else:
                                texto_opcoes = "\n".join(f"{c} | {d}" for c, d in zip(ids, documentos))
                                parecer = openai_client.chat.completions.create(
                                    model="gpt-4o-mini",
                                    messages=[
                                        {"role": "system", "content": SYSTEM_PROMPT_ENGENHARIA},
                                        {"role": "user", "content": f"Legado:\n{descricao_alvo}\n\nOpções:\n{texto_opcoes}\n\nEscolha e justifique."}
                                    ],
                                )
                                parecer_texto = parecer.choices[0].message.content
                                
                                if parecer_texto.startswith("CÓDIGO REJEITADO:"):
                                    icone_status = "🔴"
                                else:
                                    icone_status = "🟡" if "PREMISSA:" in parecer_texto else "🟢"
                                    import re
                                    match = re.search(r'(?:ACEITO|PREMISSA):\s*(\d+)', parecer_texto)
                                    if match:
                                        codigo_escolhido = match.group(1).strip()
                                        if codigo_escolhido in ids:
                                            descricao_escolhida = documentos[ids.index(codigo_escolhido)]

                            valor_unit = dict_precos.get(codigo_escolhido, 0.0)
                            unidade = dict_unidades.get(codigo_escolhido, "-")
                            valor_bdi = valor_unit * (1 + (taxa_bdi / 100))
                            
                            linhas_orcamento.append({
                                "Item": "", 
                                "Código": codigo_escolhido,
                                "Base": "SINAPI" if codigo_escolhido else "-",
                                "Descrição": descricao_escolhida if descricao_escolhida else descricao_alvo,
                                "Und": unidade,
                                "Quant.": quant_alvo,
                                "Valor Unit": valor_unit,
                                "Valor c/ BDI": valor_bdi,
                                "Total": valor_bdi * quant_alvo,
                                "Parecer Técnico": parecer_texto,
                                "Status": icone_status
                            })
                            
                            barra_progresso.progress((indice + 1) / total_linhas)
                        
                        texto_status.text("✅ Processamento concluído! Montando EAP...")
                        df_final = pd.DataFrame(linhas_orcamento)
                        df_final = recalcular_eap(df_final) 
                        st.session_state["orcamento_processado"] = df_final
                        st.rerun()
                    except Exception as e:
                        st.error(f"Erro: {e}")

        # 2. ÁREA DE TRABALHO (WORKSPACE) - SMART GRID COM EAP LIVRE E BUSCA DESACOPLADA
        else:
            df_atual = st.session_state["orcamento_processado"]
            
            with st.sidebar:
                st.subheader("📥 Fechamento")
                buffer = io.BytesIO()
                with pd.ExcelWriter(buffer, engine='xlsxwriter') as writer:
                    df_out = df_atual.copy()
                    df_out.to_excel(writer, index=False, sheet_name='Orçamento')
                
                st.download_button(
                    label="Baixar Planilha Final", 
                    data=buffer.getvalue(), 
                    file_name="orcamento_saneado.xlsx", 
                    use_container_width=True, 
                    type="primary"
                )
                st.markdown("<br>", unsafe_allow_html=True)
                if st.button("Descartar e Iniciar Novo", use_container_width=True):
                    st.session_state["orcamento_processado"] = None
                    st.rerun()

            # Cabeçalho Principal
            col_titulo, col_kpi = st.columns([3, 1])
            col_titulo.subheader("Orçamento Base")
            col_kpi.metric("Total c/ BDI", f"R$ {df_atual['Total'].sum():,.2f}")
            
            # Controles de Tabela
            col_dica, col_sort = st.columns([3, 1])
            col_dica.caption("💡 **Edite a numeração (EAP) livremente.** Títulos terminam com '.0'. Dê enter para salvar. Para auto-preencher, cole um Código SINAPI válido.")
            with col_sort:
                if st.button("🔀 Organizar Hierarquia (EAP)", use_container_width=True):
                    try:
                        df_atual['sort_key'] = df_atual['Item'].apply(
                            lambda x: [int(c) for c in str(x).split('.') if c.isdigit()] if isinstance(x, str) and str(x).strip() != "" else [999]
                        )
                        df_ordenado = df_atual.sort_values('sort_key').drop('sort_key', axis=1).reset_index(drop=True)
                        st.session_state["orcamento_processado"] = df_ordenado
                        st.rerun()
                    except Exception as e:
                        st.error("Erro ao ordenar. Verifique se a numeração está no formato correto (ex: 1.1).")

            # Tabela Interativa
            df_editado = st.data_editor(
                df_atual,
                use_container_width=True,
                hide_index=False, 
                height=450,
                num_rows="dynamic",
                column_config={
                    "Parecer Técnico": None, 
                    "Item": st.column_config.TextColumn("EAP (Editável)", disabled=False), 
                    "Código": st.column_config.TextColumn("Código"),
                    "Base": st.column_config.TextColumn("Base", disabled=True),
                    "Descrição": st.column_config.TextColumn("Descrição", width="large"),
                    "Und": st.column_config.TextColumn("Und", disabled=True),
                    "Quant.": st.column_config.NumberColumn("Quant.", format="%.2f"),
                    "Valor Unit": st.column_config.NumberColumn("Valor Unit", format="R$ %.4f", disabled=True),
                    "Valor c/ BDI": st.column_config.NumberColumn("Valor c/ BDI", format="R$ %.2f", disabled=True),
                    "Total": st.column_config.NumberColumn("Total", format="R$ %.2f", disabled=True), 
                    "Status": st.column_config.TextColumn("Status", disabled=True) 
                }
            )

            # Ouvinte Reativo de Alterações com Blindagem Matemática (Correção do Erro NoneType)
            if not df_editado.equals(df_atual):
                try:
                    caminho_sinapi = os.path.join(os.getenv("BASE_SINAPI_PATH", "./base_sinapi"), "sinapi_rs.xlsx")
                    df_base = pd.read_excel(caminho_sinapi, skiprows=9)
                    
                    # Blindagem dos cabeçalhos
                    col_cod = next((c for c in df_base.columns if 'código' in str(c).lower() or 'codigo' in str(c).lower()), df_base.columns[0])
                    col_desc = next((c for c in df_base.columns if 'descri' in str(c).lower()), df_base.columns[1])
                    col_preco = next((c for c in df_base.columns if 'custo' in str(c).lower() or 'preço' in str(c).lower()), df_base.columns[2])
                    col_und = next((c for c in df_base.columns if 'unidad' in str(c).lower() or 'und' in str(c).lower()), df_base.columns[3])
                    
                    df_base[col_cod] = df_base[col_cod].astype(str).str.strip()
                    
                    openai_client = OpenAI()
                    chroma_client = chromadb.PersistentClient(path="chroma_data")
                    collection = chroma_client.get_or_create_collection(name="sinapi_base")

                    for idx, row_edit in df_editado.iterrows():
                        row_old = df_atual.iloc[idx] if idx < len(df_atual) else None
                        
                        mudou_codigo = row_old is not None and row_edit.get('Código') != row_old.get('Código')
                        mudou_desc = row_old is not None and row_edit.get('Descrição') != row_old.get('Descrição') and row_edit.get('Status') != '🔷'
                        
                        # BUSCA REATIVA CÓDIGO
                        if mudou_codigo and pd.notna(row_edit.get('Código')) and str(row_edit['Código']).strip() != "":
                            codigo_buscado = str(row_edit['Código']).strip()
                            filtro = df_base[df_base[col_cod] == codigo_buscado]
                            if not filtro.empty:
                                preco = pd.to_numeric(filtro.iloc[0][col_preco], errors='coerce')
                                df_editado.at[idx, 'Descrição'] = filtro.iloc[0][col_desc]
                                df_editado.at[idx, 'Und'] = filtro.iloc[0][col_und]
                                df_editado.at[idx, 'Valor Unit'] = preco if pd.notna(preco) else 0.0
                                df_editado.at[idx, 'Base'] = "SINAPI"
                                df_editado.at[idx, 'Status'] = "🔄"
                        
                        # Tratamento Matemático Blindado (Evita erro de NoneType)
                        eap_val = str(row_edit.get('Item', '')).strip()
                        q = pd.to_numeric(row_edit.get('Quant.'), errors='coerce')
                        v_unit = pd.to_numeric(df_editado.at[idx, 'Valor Unit'], errors='coerce')
                        
                        if pd.isna(q): q = 0.0
                        if pd.isna(v_unit): v_unit = 0.0
                        
                        is_titulo = eap_val.endswith('.0') or (q == 0.0 and eap_val == "")
                        
                        if is_titulo:
                            df_editado.at[idx, 'Status'] = '🔷'
                            df_editado.at[idx, 'Descrição'] = str(row_edit.get('Descrição', '')).upper()
                            df_editado.at[idx, 'Und'] = '-'
                            df_editado.at[idx, 'Valor Unit'] = 0.0
                            df_editado.at[idx, 'Valor c/ BDI'] = 0.0
                            df_editado.at[idx, 'Total'] = 0.0
                        else:
                            if row_edit.get('Status') == '🔷':
                                df_editado.at[idx, 'Status'] = '⚪'
                                df_editado.at[idx, 'Und'] = 'un' if row_edit.get('Und') == '-' else row_edit.get('Und')
                            
                            taxa = 1.2158 # BDI Padrão
                            if row_old is not None:
                                old_v_unit = pd.to_numeric(row_old.get('Valor Unit'), errors='coerce')
                                old_v_bdi = pd.to_numeric(row_old.get('Valor c/ BDI'), errors='coerce')
                                # Verifica se os valores não são nulos e maiores que zero
                                if pd.notna(old_v_unit) and pd.notna(old_v_bdi) and old_v_unit > 0:
                                    taxa = old_v_bdi / old_v_unit
                            
                            novo_bdi = v_unit * taxa
                            df_editado.at[idx, 'Valor c/ BDI'] = novo_bdi
                            df_editado.at[idx, 'Total'] = novo_bdi * q

                    st.session_state["orcamento_processado"] = df_editado
                    st.rerun()
                except Exception as e:
                    st.error(f"Erro ao processar edição: {e}")

            st.divider()

            # -------------------------------------------------------------------
            # PAINEL INFERIOR: ASSISTENTE DE BUSCA LIVRE (COPIAR E COLAR)
            # -------------------------------------------------------------------
            st.subheader("🔍 Assistente de Busca SINAPI")
            st.caption("Pesquise por palavra-chave ou código. Copie o resultado desejado e cole na tabela acima para auto-preencher a linha.")
            
            termo_livre = st.text_input("Digite a descrição do serviço/material ou código SINAPI:")
            
            if termo_livre:
                try:
                    caminho_sinapi = os.path.join(os.getenv("BASE_SINAPI_PATH", "./base_sinapi"), "sinapi_rs.xlsx")
                    df_base = pd.read_excel(caminho_sinapi, skiprows=9)
                    col_cod = next((c for c in df_base.columns if 'código' in str(c).lower() or 'codigo' in str(c).lower()), df_base.columns[0])
                    col_desc = next((c for c in df_base.columns if 'descri' in str(c).lower()), df_base.columns[1])
                    col_preco = next((c for c in df_base.columns if 'custo' in str(c).lower() or 'preço' in str(c).lower()), df_base.columns[2])
                    col_und = next((c for c in df_base.columns if 'unidad' in str(c).lower() or 'und' in str(c).lower()), df_base.columns[3])
                    df_base[col_cod] = df_base[col_cod].astype(str).str.strip()

                    if termo_livre.isdigit():
                        filtro = df_base[df_base[col_cod] == termo_livre]
                        if not filtro.empty:
                            preco = pd.to_numeric(filtro.iloc[0][col_preco], errors='coerce')
                            st.success(f"**Código:** `{termo_livre}` | **Und:** {filtro.iloc[0][col_und]} | **Preço:** R$ {preco:.2f}\n\n**Descrição:** `{filtro.iloc[0][col_desc]}`")
                        else:
                            st.warning("Código não encontrado na base.")
                    else:
                        openai_client = OpenAI()
                        chroma_client = chromadb.PersistentClient(path="chroma_data")
                        collection = chroma_client.get_or_create_collection(name="sinapi_base")
                        
                        resposta_emb = openai_client.embeddings.create(model="text-embedding-3-small", input=termo_livre)
                        resultados_busca = collection.query(query_embeddings=[resposta_emb.data[0].embedding], n_results=5)
                        
                        st.markdown("**Top 5 sugestões encontradas (Copie o Código ou a Descrição):**")
                        for cod, desc in zip(resultados_busca["ids"][0], resultados_busca["documents"][0]):
                            filtro = df_base[df_base[col_cod] == cod]
                            preco = pd.to_numeric(filtro.iloc[0][col_preco], errors='coerce') if not filtro.empty else 0.0
                            und = filtro.iloc[0][col_und] if not filtro.empty else "-"
                            
                            st.info(f"**Código:** `{cod}` | **Und:** {und} | **Preço:** R$ {preco:.2f}\n\n**Descrição:** `{desc}`")

                except Exception as e:
                    st.error(f"Erro na busca: {e}")
with aba_cpus:
    st.subheader("Geração de Composições (CPUs)")
    st.write("Motor de IA para síntese de composições de itens customizados ou de alta performance.")

with aba_bdi:
    st.subheader("Validador de BDI (TCU)")
    st.write("Módulo interativo de bloqueios e alertas baseados na Súmula 2622/2013 do TCU.")






    # streamlit run app.py