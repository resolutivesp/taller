#!/usr/bin/env python3
"""Gera demo/demo-manual-pt.pdf — manual de assistência técnica ORIGINAL e
FICTÍCIO (português europeu, tal como é usado em Moçambique e Angola) para a
demonstração do Taller. O aparelho «OpenMed SP-100» não existe.

Ortografia: português europeu pré-AO90 («eléctrico», «protecção»,
«inspeccionar»), que é o que continua a ser usado na documentação técnica
oficial em Angola e Moçambique — nenhum dos dois ratificou o Acordo de 1990.
Léxico europeu: «ecrã», «registo», «binário de aperto», «ventoinha»,
«conta-horas», «vacuómetro», «estanquidade».

Mesma ESTRUTURA DE PÁGINAS das versões EN/FR: uma secção por página,
14 páginas. As sugestões guiadas da aplicação dependem de os códigos de erro
ficarem na p.7 e a resolução de avarias de aspiração na p.8.

Diferença face a gen_demo_manual.py / _fr.py: aqui as células das tabelas são
envolvidas em Paragraph para que o texto MUDE DE LINHA dentro da coluna. Com
cadeias simples o ReportLab não ajusta o texto e as células longas saem fora
da página (defeito visível nas versões EN e FR).
"""

from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, PageBreak)

# Caminho relativo ao script: <repo>/tools/gen_demo_manual_pt.py → <repo>/demo/…
OUT = Path(__file__).resolve().parent.parent / "demo" / "demo-manual-pt.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

styles = getSampleStyleSheet()
H1 = ParagraphStyle('H1x', parent=styles['Heading1'], fontSize=17, spaceAfter=8, textColor=colors.HexColor('#0e7c72'))
H2 = ParagraphStyle('H2x', parent=styles['Heading2'], fontSize=13, spaceAfter=6, textColor=colors.HexColor('#0e7c72'))
BODY = ParagraphStyle('Bodyx', parent=styles['BodyText'], fontSize=10, leading=14)
WARN = ParagraphStyle('Warnx', parent=BODY, backColor=colors.HexColor('#fff3cd'),
                      borderPadding=6, borderColor=colors.HexColor('#d9a706'), borderWidth=1)
SMALL = ParagraphStyle('Smallx', parent=BODY, fontSize=8.5, textColor=colors.grey)
CELL = ParagraphStyle('Cellx', parent=BODY, fontSize=9, leading=11, spaceBefore=0, spaceAfter=0)
CELLH = ParagraphStyle('CellHx', parent=CELL, fontName='Helvetica-Bold', textColor=colors.white)


def T(data, widths=None, header=True):
    """Tabela com células ajustadas à largura da coluna (texto simples, escapado)."""
    rows = []
    for i, row in enumerate(data):
        st = CELLH if (header and i == 0) else CELL
        rows.append([Paragraph(escape(str(c)), st) for c in row])
    t = Table(rows, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#b8c4cc')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]
    if header:
        style += [('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0e7c72'))]
    t.setStyle(TableStyle(style))
    return t


def P(text, style=BODY):
    return Paragraph(text, style)


doc = SimpleDocTemplate(str(OUT), pagesize=A4, topMargin=18*mm, bottomMargin=16*mm,
                        leftMargin=18*mm, rightMargin=18*mm,
                        title="SP-100 Aspirador de secreções — Manual de assistência técnica (DEMO)",
                        author="Projecto Taller (aparelho fictício de demonstração)")

E = []

# ---- p1 capa ----
E += [Spacer(1, 30*mm),
      P("OpenMed Instruments (fictício)", SMALL),
      P("Aspirador de secreções SP-100", ParagraphStyle('T', parent=H1, fontSize=24, leading=28)),
      P("MANUAL DE ASSISTÊNCIA TÉCNICA", ParagraphStyle('T2', parent=H1, fontSize=18)),
      Spacer(1, 8*mm),
      P("Documento SP100-SM-PT · Revisão 2.1", BODY),
      Spacer(1, 14*mm),
      P("<b>MANUAL DE DEMONSTRAÇÃO.</b> Documento original e fictício criado para demonstrar a "
        "aplicação Taller. O aparelho não existe. Não utilizar em manutenção real. Para trabalho "
        "real, importe o manual do fabricante do seu próprio equipamento.", WARN),
      PageBreak()]

# ---- p2 índice ----
E += [P("Índice", H1),
      T([["Secção", "Página"],
         ["1. Avisos de segurança", "3"],
         ["2. Características técnicas", "4"],
         ["3. Vista geral do aparelho", "5"],
         ["4. Princípio de funcionamento", "6"],
         ["5. Códigos de erro", "7"],
         ["6. Resolução de avarias — aspiração", "8"],
         ["7. Resolução de avarias — alimentação e motor", "9"],
         ["8. Resolução de avarias — sobreaquecimento e ruído", "10"],
         ["9. Plano de manutenção preventiva", "11"],
         ["10. Limpeza e desinfecção", "12"],
         ["11. Lista de peças de substituição", "13"],
         ["12. Ensaio de vácuo e calibração", "14"]], widths=[120*mm, 30*mm]),
      PageBreak()]

# ---- p3 segurança ----
E += [P("1. Avisos de segurança", H1),
      P("<b>AVISO — Risco eléctrico.</b> Desligue a ficha da rede antes de abrir a caixa. O "
        "condensador C4 pode permanecer carregado até 60 segundos após a paragem. Aguarde um "
        "minuto antes de tocar na placa de comando do motor.", WARN),
      Spacer(1, 4),
      P("<b>AVISO — Risco biológico.</b> O frasco de recolha, a tampa, a válvula de flutuador e "
        "os tubos do doente devem ser tratados como contaminados. Use luvas. Desinfecte antes de "
        "qualquer intervenção (ver secção 10).", WARN),
      Spacer(1, 4),
      P("<b>ATENÇÃO.</b> Nunca ponha a bomba a trabalhar sem o filtro antibacteriano instalado. "
        "A entrada de líquido na cabeça da bomba é a causa mais frequente de avaria prematura "
        "das membranas.", WARN),
      Spacer(1, 6),
      P("Só técnicos biomédicos com formação devem intervir neste aparelho. Após qualquer "
        "reparação, execute o ensaio de vácuo da secção 12 antes de devolver a unidade ao uso "
        "clínico. Nunca anule a protecção anti-transbordo nem o corte térmico.", BODY),
      PageBreak()]

# ---- p4 características ----
E += [P("2. Características técnicas", H1),
      T([["Parâmetro", "Valor"],
         ["Alimentação de rede", "100–240 V CA, 50/60 Hz, 90 W"],
         ["Bateria interna", "12 V 2,6 Ah chumbo estanque, autonomia 45 min"],
         ["Vácuo máximo", "−80 kPa (−600 mmHg) ± 5 %"],
         ["Caudal de ar livre", "30 L/min mínimo à entrada da bomba"],
         ["Gama do regulador de vácuo", "−10 a −80 kPa, contínua"],
         ["Frasco de recolha", "1,0 L de policarbonato, autoclavável a 121 °C"],
         ["Filtro antibacteriano", "Hidrófobo 0,2 µm, uso único, ref. FT-020"],
         ["Fusível", "T2AL 250 V, 5×20 mm, duas unidades na entrada de rede"],
         ["Tipo de bomba", "Dupla membrana sem óleo, motor CC sem escovas"],
         ["Regime de funcionamento", "Contínuo (corte térmico a 70 °C)"],
         ["Peso / dimensões", "4,8 kg · 330 × 210 × 240 mm"],
         ["Nível sonoro", "< 55 dB(A) a 1 m"]], widths=[65*mm, 95*mm]),
      PageBreak()]

# ---- p5 vista geral ----
E += [P("3. Vista geral do aparelho", H1),
      P("Conjuntos principais, do lado do doente até à entrada de rede:", BODY),
      T([["Ref", "Conjunto", "Observações"],
         ["A1", "Frasco de recolha com válvula de flutuador", "O flutuador corta a aspiração quando o frasco fica cheio (protecção anti-transbordo)"],
         ["A2", "Filtro antibacteriano FT-020", "Entre a tampa do frasco e a entrada da bomba; substituir se estiver molhado ou descolorido"],
         ["A3", "Regulador de vácuo e vacuómetro", "Válvula rotativa; escala graduada em kPa e mmHg"],
         ["A4", "Cabeça da bomba (dupla membrana)", "Duas placas de válvulas, duas membranas; kit PK-110"],
         ["A5", "Motor BLDC e placa de comando", "Comutação por sensores Hall; conector J3, 6 pinos"],
         ["A6", "Placa principal (alimentação + comando)", "Fusíveis F1/F2, condensador C4, ecrã de erros"],
         ["A7", "Conjunto de baterias", "Conector J5; substituir de 24 em 24 meses"],
         ["A8", "Módulo de entrada de rede", "IEC C14 com interruptor e gaveta de fusíveis"]], widths=[12*mm, 58*mm, 90*mm]),
      P("A caixa abre-se com quatro parafusos Torx T15 situados por baixo dos pés de borracha. "
        "A cabeça da bomba assenta em dois apoios antivibratórios; não exceda um binário de "
        "aperto de 0,8 N·m.", BODY),
      PageBreak()]

# ---- p6 princípio ----
E += [P("4. Princípio de funcionamento", H1),
      P("O motor sem escovas acciona um excêntrico que flecte duas membranas em oposição. As "
        "válvulas de palheta das placas rectificam o fluxo de ar e criam o vácuo no orifício de "
        "entrada. A placa de comando regula a velocidade do motor para manter o vácuo "
        "seleccionado no regulador, vigia a corrente do motor, a tensão da bateria e a "
        "temperatura da cabeça, e assinala as avarias através dos códigos de erro E1 a E8 no "
        "ecrã frontal.", BODY),
      P("Com a rede presente, a bateria carrega a 0,4 A; o aparelho passa automaticamente a "
        "bateria em caso de falha da rede. Se o frasco transbordar, a válvula de flutuador veda "
        "a tampa: o vácuo sobe bruscamente enquanto o caudal se anula — isto protege o filtro e "
        "a bomba e desencadeia geralmente o erro E5 (entrada obstruída).", BODY),
      P("A corrente típica a −60 kPa é de 1,1 a 1,4 A na linha de 12 V. Um valor superior a "
        "2,0 A com vácuo baixo indica uma avaria mecânica da cabeça da bomba (ver secção 6).", BODY),
      PageBreak()]

# ---- p7 códigos de erro ----
E += [P("5. Códigos de erro", H1),
      P("Os códigos aparecem no ecrã frontal. Mantenha MODE premido durante 3 s para ver os cinco "
        "últimos códigos memorizados com a marca do conta-horas.", BODY),
      T([["Código", "Significado", "Primeiras verificações"],
         ["E1", "Avaria do fusível de rede / rede ausente", "Verificar os fusíveis F1 e F2 (T2AL 250 V) na gaveta da entrada; verificar o cabo de alimentação e a tomada"],
         ["E2", "Bateria fraca (< 10,8 V)", "Ligar à rede 8 h; se E2 voltar depressa, ensaiar a capacidade e substituir o conjunto (vida útil típica de 24 meses)"],
         ["E3", "Bloqueio do motor / sobreintensidade", "Desacoplar o excêntrico da cabeça; se o motor rodar livremente, inspeccionar membranas e placas de válvulas (entrada de líquido); verificar o encaixe do conector J3"],
         ["E4", "Sobreaquecimento da cabeça da bomba (> 70 °C)", "Deixar arrefecer 30 min; limpar as grelhas de ventilação; verificar se a ventoinha roda; verificar as condições de utilização (ambiente < 40 °C)"],
         ["E5", "Entrada obstruída / sem caudal com vácuo elevado", "Esvaziar o frasco (o flutuador pode estar colado); substituir o filtro FT-020 se estiver molhado; verificar se há dobras nos tubos"],
         ["E6", "Sensor de vácuo fora de gama", "Verificar se o tubo do sensor para a porta P1 da placa principal tem fissuras; repor a zero conforme a secção 12; substituir o sensor S2 se a deriva for > ±3 kPa"],
         ["E7", "Avaria do sensor Hall / comutação", "Voltar a ligar J3; medir 5 V no pino 1 de J3; substituir o motor se alguma linha Hall ficar fixa ao rodar o veio à mão"],
         ["E8", "Avaria interna da placa de comando", "Desligar e voltar a ligar uma vez; se E8 persistir, substituir a placa MB-100 — não tentar reparação ao nível do componente no local"]],
        widths=[16*mm, 50*mm, 94*mm]),
      PageBreak()]

# ---- p8 avarias de aspiração ----
E += [P("6. Resolução de avarias — aspiração", H1),
      P("6.1 Sem aspiração no tubo do doente", H2),
      P("Avance do lado do doente para a bomba: "
        "(1) Tampa do frasco mal assente ou vedante danificado — voltar a colocar a tampa e inspeccionar o vedante G-101 quanto a cortes; "
        "(2) Válvula de flutuador colada na posição fechada após um transbordo — esvaziar o frasco, enxaguar o flutuador e verificar se se move livremente; "
        "(3) Filtro antibacteriano FT-020 molhado ou colmatado — substituir, nunca lavar; "
        "(4) Tubos dobrados ou ligações fissuradas — substituir o conjunto de tubos TS-210; "
        "(5) Regulador totalmente aberto à atmosfera — rodar no sentido dos ponteiros do relógio para aumentar o vácuo; "
        "(6) Se continuar sem aspiração com a entrada tapada com o dedo e o vacuómetro a zero: avaria da cabeça da bomba — ver 6.3.", BODY),
      P("6.2 Aspiração fraca (vácuo abaixo de −40 kPa com a entrada tapada)", H2),
      P("Causas mais frequentes no terreno: vedante do frasco com fuga (substituir G-101), tubo "
        "de silicone interno degradado entre a porta do filtro e a entrada da bomba (substituir, "
        "silicone 6×9 mm) e membranas gastas ao fim de cerca de 3 000 h (montar o kit de bomba "
        "PK-110). Água com sabão nas ligações revela as fugas sob a forma de bolhas com o "
        "aparelho a trabalhar. Verifique o próprio vacuómetro contra um padrão fiável antes de "
        "substituir peças.", BODY),
      P("6.3 Intervenção na cabeça da bomba", H2),
      P("Retire os quatro parafusos M4 da tampa da cabeça. Marque a orientação das membranas "
        "antes da desmontagem. Inspeccione as válvulas de palheta quanto a corrosão ou detritos; "
        "limpe os assentos apenas com álcool isopropílico. Monte as membranas novas com os "
        "parafusos do kit, com binário de 0,8 N·m em cruz. Ponha a trabalhar 5 min e execute o "
        "ensaio de vácuo da secção 12.", BODY),
      PageBreak()]

# ---- p9 alimentação/motor ----
E += [P("7. Resolução de avarias — alimentação e motor", H1),
      P("7.1 Aparelho completamente inerte", H2),
      P("Verificar por esta ordem: tomada com tensão (lâmpada de teste); continuidade do cabo de "
        "alimentação; fusíveis F1/F2 na gaveta da entrada — substituir apenas por T2AL 250 V; "
        "continuidade do interruptor de entrada; presença de 12 V no conector da bateria J5 (a "
        "bateria pode estar profundamente descarregada — o aparelho pode trabalhar a partir da "
        "rede com a bateria desligada, para diagnóstico). Um fusível que volta a fundir de "
        "imediato indica um rectificador em curto-circuito na placa principal ou um motor "
        "gripado — não continue a substituir fusíveis.", BODY),
      P("7.2 Trabalha na rede mas não na bateria", H2),
      P("Meça a tensão da bateria em vazio: abaixo de 11,5 V após 8 h de carga, o conjunto está "
        "gasto — substitua-o (ref. BT-126). Verifique o fusível de lâmina de 3 A do cabo da "
        "bateria. Se o indicador de carga nunca acender, meça 13,8 V em J5 com a rede ligada; se "
        "não houver tensão → avaria do carregador na placa principal.", BODY),
      P("7.3 O motor arranca e volta a parar (muitas vezes com E3)", H2),
      P("A entrada de líquido emperra a cabeça da bomba: retire a tampa da cabeça e verifique se "
        "há líquido. Rode o excêntrico à mão — deve rodar suavemente. Verifique se o conector J3 "
        "está totalmente encaixado (as vibrações soltam-no). Meça a resistência das fases do "
        "motor: 0,8 a 1,2 Ω entre quaisquer dois pinos de fase; enrolamento aberto ou em "
        "curto-circuito → substituir o motor MT-100.", BODY),
      PageBreak()]

# ---- p10 sobreaquecimento/ruído ----
E += [P("8. Resolução de avarias — sobreaquecimento e ruído", H1),
      P("8.1 Sobreaquecimento / E4 repetidos", H2),
      P("Retire o pó das grelhas de ventilação e da ventoinha com uma escova seca. Confirme que a "
        "ventoinha roda acima de −30 kPa de carga. Verifique a temperatura ambiente e que o "
        "aparelho não está fechado dentro de um armário. Uma cabeça de bomba montada sem os "
        "apoios antivibratórios, ou o funcionamento contínuo ao vácuo máximo com ambiente acima "
        "de 40 °C, fará actuar ciclicamente o corte térmico — isso é uma protecção, não é uma "
        "avaria.", BODY),
      P("8.2 Ruído ou vibração excessivos", H2),
      P("Chocalhar: parafusos da caixa soltos ou apoios antivibratórios fissurados (substituir "
        "aos pares, ref. AV-014). Batimento com vácuo baixo: rolamento do excêntrico gasto — "
        "substituir com o kit de bomba PK-110. Assobio agudo: batimento de uma válvula de "
        "palheta, geralmente detritos num assento — limpar conforme 6.3. Após qualquer reparação "
        "de ruído, ponha a trabalhar a −60 kPa durante 10 minutos e confirme que a temperatura "
        "da cabeça se mantém abaixo de 60 °C.", BODY),
      P("8.3 Ecrã apagado mas a bomba trabalha", H2),
      P("Volte a encaixar o cabo plano do ecrã no conector J7. Se faltarem segmentos, substitua o "
        "módulo de ecrã DP-100; o aparelho continua utilizável a curto prazo — o vácuo continua a "
        "ser regulado mecanicamente.", BODY),
      PageBreak()]

# ---- p11 manutenção preventiva ----
E += [P("9. Plano de manutenção preventiva", H1),
      T([["Periodicidade", "Tarefa", "Peças"],
         ["Diária (utilizador)", "Esvaziar e desinfectar o frasco; verificar se o filtro está seco; testar a aspiração tapando a entrada com o dedo", "—"],
         ["Mensal", "Inspeccionar os tubos e o vedante da tampa; limpar as grelhas de ventilação; ensaiar a autonomia da bateria ≥ 30 min", "G-101 se danificado"],
         ["6 meses", "Ensaio de vácuo (secção 12); verificar a gaveta de fusíveis; confirmar que o flutuador se move livremente", "—"],
         ["12 meses", "Rotação do stock de filtros; ensaio de capacidade da bateria; ensaio de segurança eléctrica (limites de fuga classe II)", "FT-020"],
         ["24 meses", "Substituir o conjunto de baterias; substituir o jogo de vedantes do frasco; considerar o kit de membranas se > 3 000 h", "BT-126, G-101, PK-110"]],
        widths=[30*mm, 88*mm, 42*mm]),
      P("Anote cada intervenção no seu registo de manutenção com a data, a leitura do conta-horas "
        "e as peças utilizadas. No terreno, os aparelhos com registo completo apresentam cerca de "
        "metade das paragens imprevistas dos aparelhos sem acompanhamento.", BODY),
      PageBreak()]

# ---- p12 limpeza ----
E += [P("10. Limpeza e desinfecção", H1),
      P("Frasco, tampa e flutuador: lavar com água quente e detergente e depois desinfectar "
        "(cloro a 0,5 % durante 10 min ou autoclave a 121 °C / 15 min — apenas o frasco de "
        "policarbonato; vigiar o aparecimento de microfissuras após ciclos repetidos). Os "
        "conjuntos de tubos são de doente único sempre que o abastecimento o permita; caso "
        "contrário, desinfecção química, nunca autoclave em tubos de PVC.", BODY),
      P("Caixa: limpar com álcool isopropílico a 70 %. Nunca pulverizar líquidos na direcção das "
        "grelhas de ventilação. O filtro antibacteriano FT-020 não pode ser limpo nem "
        "reutilizado: molhado, bloqueia o caudal (E5) e perde a função de barreira.", BODY),
      P("Antes de abrir o aparelho para assistência, ponha-o a trabalhar 30 s com um frasco de "
        "desinfectante ligado, limpe as superfícies exteriores e use luvas durante toda a "
        "intervenção.", BODY),
      PageBreak()]

# ---- p13 peças ----
E += [P("11. Lista de peças de substituição", H1),
      T([["Ref.", "Designação", "Substituição típica"],
         ["FT-020", "Filtro antibacteriano 0,2 µm hidrófobo", "Se molhado ou descolorido; rotação de stock de 12 meses"],
         ["G-101", "Vedante da tampa do frasco, silicone", "Se danificado; de 24 em 24 meses"],
         ["TS-210", "Conjunto de tubos do lado do doente, 2 m", "Se danificado ou conforme a política de higiene"],
         ["PK-110", "Kit de bomba: 2 membranas, 2 placas de válvulas, parafusos", "~3 000 h ou após entrada de líquido"],
         ["BT-126", "Bateria 12 V 2,6 Ah chumbo estanque", "24 meses"],
         ["MT-100", "Motor BLDC com sensores Hall", "Se falhar o enrolamento ou um sensor Hall"],
         ["MB-100", "Placa principal (alimentação + comando)", "Se E8 persistir"],
         ["DP-100", "Módulo de ecrã", "Se o ecrã falhar"],
         ["AV-014", "Apoios antivibratórios (par)", "Se fissurados ou com ruído"],
         ["FU-T2A", "Fusível T2AL 250 V 5×20 mm (×10)", "Conforme necessário — procurar a causa das fusões repetidas"]],
        widths=[22*mm, 84*mm, 54*mm]),
      P("Equivalentes genéricos: o fusível, o tubo de silicone (6×9 mm) e a bateria de chumbo são "
        "peças correntes disponíveis na maioria dos mercados; respeite exactamente as "
        "características nominais.", BODY),
      PageBreak()]

# ---- p14 calibração ----
E += [P("12. Ensaio de vácuo e calibração", H1),
      P("12.1 Ensaio de desempenho (após cada reparação)", H2),
      P("(1) Montar um frasco limpo e um filtro seco e fechar a entrada com a tampa de ensaio. "
        "(2) Funcionamento no máximo: o vacuómetro deve atingir −75 kPa ou melhor em 10 s. "
        "(3) Parar a bomba: o vácuo não deve descer mais de 5 kPa em 60 s (ensaio de "
        "estanquidade). (4) Regular para −30 kPa: o valor deve manter-se dentro de ± 3 kPa "
        "durante 5 min. (5) Caudal livre: com a entrada aberta, um frasco de 1 L de água elevada "
        "0,5 m enche em menos de 25 s (≈ 30 L/min equivalente de ar).", BODY),
      P("12.2 Reposição a zero do sensor de vácuo", H2),
      P("Com o aparelho desligado e a entrada aberta à atmosfera, mantenha premidos MODE + LIGAR "
        "durante 5 s até aparecer «CAL» e depois prima MODE uma vez. O ecrã indica «0.0». Se E6 "
        "persistir após a reposição a zero, substitua o sensor S2 na placa principal (peça "
        "encaixável, sem soldadura).", BODY),
      P("12.3 Segurança eléctrica", H2),
      P("Após qualquer abertura da caixa: ensaio de corrente de contacto classe II conforme a "
        "norma local aplicável (limites da IEC 62353). Registe os resultados no registo de "
        "manutenção.", BODY),
      Spacer(1, 8*mm),
      P("— Fim do manual de demonstração. Aparelho fictício, conteúdo original, criado para o projecto Taller. —", SMALL)]

doc.build(E)
print("escrito", OUT)
