#!/usr/bin/env python3
"""Genera demo/demo-manual-es.pdf — manual de servicio ORIGINAL y FICTICIO
(español neutro de América Latina) para la demostración de Taller.
El equipo «OpenMed SP-100» no existe.

Misma ESTRUCTURA DE PÁGINAS que las versiones EN/FR: una sección por página,
14 páginas. Las sugerencias guiadas de la app dependen de que los códigos de
error queden en la p.7 y el diagnóstico de aspiración en la p.8.

Diferencia con gen_demo_manual.py / _fr.py: aquí las celdas de tabla se
envuelven en Paragraph para que el texto SALTE DE LÍNEA dentro de la columna.
Con cadenas simples, ReportLab no ajusta el texto y las celdas largas se salen
de la página (bug visible en las versiones EN y FR).
"""

from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, PageBreak)

# Ruta relativa al script: <repo>/tools/gen_demo_manual_es.py → <repo>/demo/…
OUT = Path(__file__).resolve().parent.parent / "demo" / "demo-manual-es.pdf"
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
    """Tabla con celdas ajustadas al ancho de columna (texto plano, se escapa)."""
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
                        title="SP-100 Aspirador de secreciones — Manual de servicio (DEMO)",
                        author="Proyecto Taller (equipo ficticio de demostración)")

E = []

# ---- p1 portada ----
E += [Spacer(1, 30*mm),
      P("OpenMed Instruments (ficticio)", SMALL),
      P("Aspirador de secreciones SP-100", ParagraphStyle('T', parent=H1, fontSize=24, leading=28)),
      P("MANUAL DE SERVICIO", ParagraphStyle('T2', parent=H1, fontSize=18)),
      Spacer(1, 8*mm),
      P("Documento SP100-SM-ES · Revisión 2.1", BODY),
      Spacer(1, 14*mm),
      P("<b>MANUAL DE DEMOSTRACIÓN.</b> Documento original y ficticio creado para demostrar "
        "la aplicación Taller. El equipo no existe. No lo utilice para mantenimiento real. "
        "Para el trabajo real, importe el manual del fabricante de su propio equipo.", WARN),
      PageBreak()]

# ---- p2 contenido ----
E += [P("Contenido", H1),
      T([["Sección", "Página"],
         ["1. Advertencias de seguridad", "3"],
         ["2. Especificaciones técnicas", "4"],
         ["3. Descripción general del equipo", "5"],
         ["4. Principio de funcionamiento", "6"],
         ["5. Códigos de error", "7"],
         ["6. Diagnóstico — problemas de aspiración", "8"],
         ["7. Diagnóstico — alimentación y motor", "9"],
         ["8. Diagnóstico — sobrecalentamiento y ruido", "10"],
         ["9. Plan de mantenimiento preventivo", "11"],
         ["10. Limpieza y desinfección", "12"],
         ["11. Lista de repuestos", "13"],
         ["12. Prueba de vacío y calibración", "14"]], widths=[120*mm, 30*mm]),
      PageBreak()]

# ---- p3 seguridad ----
E += [P("1. Advertencias de seguridad", H1),
      P("<b>ADVERTENCIA — Riesgo eléctrico.</b> Desconecte el enchufe de la red antes de abrir la "
        "carcasa. El condensador C4 puede permanecer cargado hasta 60 segundos después del apagado. "
        "Espere un minuto antes de tocar la tarjeta de control del motor.", WARN),
      Spacer(1, 4),
      P("<b>ADVERTENCIA — Riesgo biológico.</b> El frasco colector, su tapa, la válvula de flotador "
        "y el tubo del paciente deben tratarse como material contaminado. Use guantes. Desinfecte "
        "antes de cualquier intervención (véase la sección 10).", WARN),
      Spacer(1, 4),
      P("<b>PRECAUCIÓN.</b> Nunca haga funcionar la bomba sin el filtro antibacteriano instalado. "
        "El ingreso de líquido al cabezal de bomba es la causa más frecuente de falla prematura "
        "de las membranas.", WARN),
      Spacer(1, 6),
      P("Solo técnicos biomédicos capacitados deben intervenir este equipo. Después de cualquier "
        "reparación, realice la prueba de vacío de la sección 12 antes de devolverlo al uso clínico. "
        "Nunca anule la protección contra desbordamiento ni el corte térmico.", BODY),
      PageBreak()]

# ---- p4 especificaciones ----
E += [P("2. Especificaciones técnicas", H1),
      T([["Parámetro", "Valor"],
         ["Alimentación de red", "100–240 V CA, 50/60 Hz, 90 W"],
         ["Batería interna", "12 V 2,6 Ah plomo-ácido sellada, autonomía 45 min"],
         ["Vacío máximo", "−80 kPa (−600 mmHg) ± 5 %"],
         ["Caudal de aire libre", "30 L/min mínimo en la entrada de la bomba"],
         ["Rango del regulador de vacío", "−10 a −80 kPa, continuo"],
         ["Frasco colector", "1,0 L de policarbonato, autoclavable a 121 °C"],
         ["Filtro antibacteriano", "Hidrofóbico 0,2 µm, un solo uso, ref. FT-020"],
         ["Fusible", "T2AL 250 V, 5×20 mm, dos unidades en la entrada de red"],
         ["Tipo de bomba", "Doble membrana sin aceite, motor CC sin escobillas"],
         ["Ciclo de trabajo", "Continuo (corte térmico a 70 °C)"],
         ["Peso / dimensiones", "4,8 kg · 330 × 210 × 240 mm"],
         ["Nivel sonoro", "< 55 dB(A) a 1 m"]], widths=[65*mm, 95*mm]),
      PageBreak()]

# ---- p5 descripción general ----
E += [P("3. Descripción general del equipo", H1),
      P("Conjuntos principales, desde el lado del paciente hasta la entrada de red:", BODY),
      T([["Ref", "Conjunto", "Notas"],
         ["A1", "Frasco colector con válvula de flotador", "El flotador corta la aspiración cuando el frasco se llena (protección contra desbordamiento)"],
         ["A2", "Filtro antibacteriano FT-020", "Entre la tapa del frasco y la entrada de la bomba; reemplácelo si está mojado o decolorado"],
         ["A3", "Regulador de vacío y vacuómetro", "Válvula rotativa; escala graduada en kPa y mmHg"],
         ["A4", "Cabezal de bomba (doble membrana)", "Dos placas de válvulas, dos membranas; kit PK-110"],
         ["A5", "Motor BLDC y tarjeta de control", "Conmutación por sensores Hall; conector J3, 6 pines"],
         ["A6", "Tarjeta principal (fuente + control)", "Fusibles F1/F2, condensador C4, pantalla de errores"],
         ["A7", "Paquete de baterías", "Conector J5; reemplazar cada 24 meses"],
         ["A8", "Módulo de entrada de red", "IEC C14 con interruptor y portafusibles"]], widths=[12*mm, 58*mm, 90*mm]),
      P("La carcasa se abre con cuatro tornillos Torx T15 ubicados debajo de las patas de goma. "
        "El cabezal de bomba se monta sobre dos soportes antivibratorios; no exceda un apriete "
        "de 0,8 N·m.", BODY),
      PageBreak()]

# ---- p6 principio ----
E += [P("4. Principio de funcionamiento", H1),
      P("El motor sin escobillas acciona una excéntrica que flexiona dos membranas en oposición. "
        "Las válvulas de lámina de las placas rectifican el flujo de aire y generan vacío en el "
        "puerto de entrada. La tarjeta de control regula la velocidad del motor para mantener el "
        "vacío seleccionado en el regulador, vigila la corriente del motor, la tensión de la "
        "batería y la temperatura del cabezal, y señala las fallas mediante los códigos de error "
        "E1 a E8 en la pantalla frontal.", BODY),
      P("Cuando hay red eléctrica, la batería se carga a 0,4 A; el equipo conmuta automáticamente "
        "a batería si falla la red. Si el frasco se desborda, la válvula de flotador sella la "
        "tapa: el vacío sube bruscamente mientras el caudal se anula — esto protege el filtro y "
        "la bomba, y por lo general activa el error E5 (entrada obstruida).", BODY),
      P("La corriente típica a −60 kPa es de 1,1 a 1,4 A en el riel de 12 V. Un valor superior a "
        "2,0 A con vacío bajo indica una falla mecánica del cabezal de bomba (véase la sección 6).", BODY),
      PageBreak()]

# ---- p7 códigos de error ----
E += [P("5. Códigos de error", H1),
      P("Los códigos aparecen en la pantalla frontal. Mantenga pulsado MODE durante 3 s para ver "
        "los cinco últimos códigos memorizados con la marca del horómetro.", BODY),
      T([["Código", "Significado", "Primeras acciones"],
         ["E1", "Falla de fusible de red / red ausente", "Revisar los fusibles F1 y F2 (T2AL 250 V) en el portafusibles de la entrada; verificar el cable y el tomacorriente"],
         ["E2", "Batería baja (< 10,8 V)", "Conectar a la red 8 h; si E2 reaparece pronto, probar la capacidad y reemplazar el paquete (vida útil típica de 24 meses)"],
         ["E3", "Bloqueo del motor / sobrecorriente", "Desacoplar la excéntrica del cabezal; si el motor gira libre, inspeccionar membranas y placas de válvulas por ingreso de líquido; verificar el asiento del conector J3"],
         ["E4", "Sobretemperatura del cabezal de bomba (> 70 °C)", "Dejar enfriar 30 min; limpiar las rejillas de ventilación; verificar que el ventilador gire; comprobar las condiciones de uso (ambiente < 40 °C)"],
         ["E5", "Entrada obstruida / sin caudal con vacío alto", "Vaciar el frasco (el flotador puede estar sellado); reemplazar el filtro FT-020 si está mojado; revisar los tubos por dobleces"],
         ["E6", "Sensor de vacío fuera de rango", "Revisar por fisuras la manguera del sensor hacia el puerto P1 de la tarjeta principal; poner a cero según la sección 12; reemplazar el sensor S2 si la deriva es > ±3 kPa"],
         ["E7", "Falla de sensor Hall / conmutación", "Reconectar J3; medir 5 V en el pin 1 de J3; reemplazar el motor si alguna línea Hall queda fija al girar el eje a mano"],
         ["E8", "Falla interna de la tarjeta de control", "Apagar y encender una vez; si E8 persiste, reemplazar la tarjeta MB-100 — no intente reparación a nivel de componente en sitio"]],
        widths=[16*mm, 50*mm, 94*mm]),
      PageBreak()]

# ---- p8 diagnóstico de aspiración ----
E += [P("6. Diagnóstico — problemas de aspiración", H1),
      P("6.1 Sin aspiración en el tubo del paciente", H2),
      P("Avance desde el lado del paciente hacia la bomba: "
        "(1) Tapa del frasco mal asentada o junta dañada — vuelva a colocar la tapa e inspeccione la junta G-101 en busca de cortes; "
        "(2) Válvula de flotador trabada en posición cerrada tras un desbordamiento — vacíe el frasco, enjuague el flotador y verifique que se mueva libremente; "
        "(3) Filtro antibacteriano FT-020 mojado u obstruido — reemplácelo, nunca lo lave; "
        "(4) Tubos doblados o conectores fisurados — reemplace el juego de tubos TS-210; "
        "(5) Regulador completamente abierto a la atmósfera — gírelo en sentido horario para aumentar el vacío; "
        "(6) Si sigue sin haber aspiración con la entrada tapada con el dedo y el vacuómetro en cero: falla del cabezal de bomba — véase 6.3.", BODY),
      P("6.2 Aspiración débil (vacío por debajo de −40 kPa con la entrada tapada)", H2),
      P("Causas más frecuentes en equipos de campo: junta del frasco con fuga (reemplace G-101), "
        "manguera de silicona interna deteriorada entre el puerto del filtro y la entrada de la "
        "bomba (reemplace, silicona 6×9 mm) y membranas desgastadas después de unas 3 000 h "
        "(monte el kit de bomba PK-110). El agua jabonosa sobre las uniones revela las fugas en "
        "forma de burbujas con el equipo en marcha. Verifique el vacuómetro contra uno patrón "
        "antes de reemplazar piezas.", BODY),
      P("6.3 Intervención en el cabezal de bomba", H2),
      P("Retire los cuatro tornillos M4 de la tapa del cabezal. Marque la orientación de las "
        "membranas antes de desmontarlas. Inspeccione las válvulas de lámina en busca de corrosión "
        "o residuos; limpie los asientos únicamente con alcohol isopropílico. Monte las membranas "
        "nuevas con los tornillos del kit, con un apriete de 0,8 N·m en cruz. Haga funcionar 5 min "
        "y realice la prueba de vacío de la sección 12.", BODY),
      PageBreak()]

# ---- p9 alimentación/motor ----
E += [P("7. Diagnóstico — alimentación y motor", H1),
      P("7.1 Equipo completamente muerto", H2),
      P("Verifique en este orden: tomacorriente con tensión (lámpara de prueba); continuidad del "
        "cable de alimentación; fusibles F1/F2 en el portafusibles de la entrada — reemplácelos "
        "únicamente por T2AL 250 V; continuidad del interruptor de entrada; presencia de 12 V en "
        "el conector de batería J5 (la batería puede estar profundamente descargada — el equipo "
        "puede funcionar desde la red con la batería desconectada para el diagnóstico). Un fusible "
        "que se vuelve a quemar de inmediato indica un rectificador en cortocircuito en la tarjeta "
        "principal o un motor agarrotado — no siga reemplazando fusibles.", BODY),
      P("7.2 Funciona con red eléctrica pero no con batería", H2),
      P("Mida la tensión de la batería en vacío: por debajo de 11,5 V después de 8 h de carga, el "
        "paquete está agotado — reemplácelo (ref. BT-126). Revise el fusible de cuchilla de 3 A "
        "del cable de batería. Si el indicador de carga nunca enciende, mida 13,8 V en J5 con la "
        "red conectada; si no hay tensión → falla de la sección cargador en la tarjeta principal.", BODY),
      P("7.3 El motor intenta arrancar y se detiene (a menudo con E3)", H2),
      P("El ingreso de líquido engoma el cabezal de bomba: retire la tapa del cabezal y verifique "
        "si hay líquido. Gire la excéntrica a mano — debe girar suavemente. Verifique que el "
        "conector J3 esté completamente trabado (las vibraciones lo aflojan). Mida la resistencia "
        "de fase del motor: 0,8 a 1,2 Ω entre dos pines de fase cualesquiera; devanado abierto o "
        "en cortocircuito → reemplace el motor MT-100.", BODY),
      PageBreak()]

# ---- p10 sobrecalentamiento/ruido ----
E += [P("8. Diagnóstico — sobrecalentamiento y ruido", H1),
      P("8.1 Sobrecalentamiento / E4 repetidos", H2),
      P("Elimine el polvo de las rejillas de ventilación y del ventilador con un cepillo seco. "
        "Confirme que el ventilador gira por encima de −30 kPa de carga. Revise la temperatura "
        "ambiente y que el equipo no esté encerrado en un mueble. Un cabezal de bomba armado sin "
        "los soportes antivibratorios, o el funcionamiento continuo al vacío máximo con "
        "temperatura ambiente superior a 40 °C, hará que actúe cíclicamente el corte térmico — "
        "eso es una protección, no una falla.", BODY),
      P("8.2 Ruido o vibración excesivos", H2),
      P("Traqueteo: tornillos de la carcasa flojos o soportes antivibratorios fisurados "
        "(reemplácelos de a pares, ref. AV-014). Golpeteo con vacío bajo: rodamiento de la "
        "excéntrica desgastado — reemplácelo con el kit de bomba PK-110. Silbido agudo: aleteo de "
        "una válvula de lámina, por lo general un residuo sobre el asiento — limpie según 6.3. "
        "Después de cualquier reparación por ruido, haga funcionar a −60 kPa durante 10 minutos y "
        "confirme que la temperatura del cabezal se mantiene por debajo de 60 °C.", BODY),
      P("8.3 Pantalla apagada pero la bomba funciona", H2),
      P("Vuelva a asentar el cable plano de la pantalla en el conector J7. Si faltan segmentos, "
        "reemplace el módulo de pantalla DP-100; el equipo puede seguir usándose a corto plazo — "
        "el vacío se sigue regulando mecánicamente.", BODY),
      PageBreak()]

# ---- p11 mantenimiento preventivo ----
E += [P("9. Plan de mantenimiento preventivo", H1),
      T([["Periodicidad", "Tarea", "Repuestos"],
         ["Diaria (usuario)", "Vaciar y desinfectar el frasco; verificar que el filtro esté seco; probar la aspiración tapando la entrada con el dedo", "—"],
         ["Mensual", "Inspeccionar los tubos y la junta de la tapa; limpiar las rejillas de ventilación; probar la autonomía de la batería ≥ 30 min", "G-101 si está dañada"],
         ["6 meses", "Prueba de vacío (sección 12); revisar el portafusibles; verificar que el flotador se mueva libremente", "—"],
         ["12 meses", "Rotación del stock de filtros; prueba de capacidad de la batería; prueba de seguridad eléctrica (límites de fuga clase II)", "FT-020"],
         ["24 meses", "Reemplazar el paquete de baterías; reemplazar el juego de juntas del frasco; considerar el kit de membranas si > 3 000 h", "BT-126, G-101, PK-110"]],
        widths=[30*mm, 88*mm, 42*mm]),
      P("Anote cada intervención en su registro de mantenimiento con la fecha, la lectura del "
        "horómetro y los repuestos utilizados. En campo, los equipos con registro completo "
        "presentan alrededor de la mitad de las paradas imprevistas que los equipos sin "
        "seguimiento.", BODY),
      PageBreak()]

# ---- p12 limpieza ----
E += [P("10. Limpieza y desinfección", H1),
      P("Frasco, tapa y flotador: lavar con agua tibia y detergente, luego desinfectar (cloro al "
        "0,5 % durante 10 min o autoclave a 121 °C / 15 min — únicamente el frasco de "
        "policarbonato; vigile la aparición de microfisuras tras ciclos repetidos). Los juegos de "
        "tubos son de un solo paciente cuando el abastecimiento lo permite; de lo contrario, "
        "desinfección química, nunca autoclave sobre tubos de PVC.", BODY),
      P("Carcasa: limpiar con alcohol isopropílico al 70 %. Nunca rocíe líquidos hacia las "
        "rejillas de ventilación. El filtro antibacteriano FT-020 no se puede limpiar ni "
        "reutilizar: mojado, bloquea el caudal (E5) y pierde su función de barrera.", BODY),
      P("Antes de abrir el equipo para darle servicio, hágalo funcionar 30 s con un frasco de "
        "desinfectante conectado, limpie las superficies externas y use guantes durante toda la "
        "intervención.", BODY),
      PageBreak()]

# ---- p13 repuestos ----
E += [P("11. Lista de repuestos", H1),
      T([["Ref.", "Descripción", "Reemplazo típico"],
         ["FT-020", "Filtro antibacteriano 0,2 µm hidrofóbico", "Si está mojado o decolorado; rotación de stock cada 12 meses"],
         ["G-101", "Junta de la tapa del frasco, silicona", "Si está dañada; cada 24 meses"],
         ["TS-210", "Juego de tubos lado paciente, 2 m", "Si está dañado o según la política de higiene"],
         ["PK-110", "Kit de bomba: 2 membranas, 2 placas de válvulas, tornillos", "~3 000 h o tras ingreso de líquido"],
         ["BT-126", "Batería 12 V 2,6 Ah plomo-ácido sellada", "24 meses"],
         ["MT-100", "Motor BLDC con sensores Hall", "Si falla el devanado o un sensor Hall"],
         ["MB-100", "Tarjeta principal (fuente + control)", "Si E8 persiste"],
         ["DP-100", "Módulo de pantalla", "Si falla la pantalla"],
         ["AV-014", "Soportes antivibratorios (par)", "Si están fisurados o hay ruido"],
         ["FU-T2A", "Fusible T2AL 250 V 5×20 mm (×10)", "Según necesidad — busque la causa raíz de las quemaduras repetidas"]],
        widths=[22*mm, 84*mm, 54*mm]),
      P("Equivalentes genéricos: el fusible, la manguera de silicona (6×9 mm) y la batería de "
        "plomo-ácido son piezas estándar disponibles en la mayoría de los mercados; respete "
        "exactamente las características nominales.", BODY),
      PageBreak()]

# ---- p14 calibración ----
E += [P("12. Prueba de vacío y calibración", H1),
      P("12.1 Prueba de desempeño (después de cada reparación)", H2),
      P("(1) Monte un frasco limpio y un filtro seco, y cierre la entrada con el tapón de prueba. "
        "(2) Funcionamiento al máximo: el vacuómetro debe alcanzar −75 kPa o mejor en 10 s. "
        "(3) Detenga la bomba: el vacío no debe caer más de 5 kPa en 60 s (prueba de fugas). "
        "(4) Ajuste el regulador a −30 kPa: el valor debe mantenerse dentro de ± 3 kPa durante "
        "5 min. (5) Caudal libre: con la entrada abierta, un frasco de 1 L de agua elevada 0,5 m "
        "se llena en menos de 25 s (≈ 30 L/min equivalente de aire).", BODY),
      P("12.2 Puesta a cero del sensor de vacío", H2),
      P("Con el equipo apagado y la entrada abierta a la atmósfera, mantenga pulsados MODE + "
        "ENCENDIDO durante 5 s hasta que aparezca «CAL» y luego pulse MODE una vez. La pantalla "
        "indica «0.0». Si E6 persiste después de la puesta a cero, reemplace el sensor S2 en la "
        "tarjeta principal (pieza enchufable, sin soldadura).", BODY),
      P("12.3 Seguridad eléctrica", H2),
      P("Después de cualquier apertura de la carcasa: prueba de corriente de contacto clase II "
        "según su norma local (límites de la IEC 62353). Anote los resultados en el registro de "
        "mantenimiento.", BODY),
      Spacer(1, 8*mm),
      P("— Fin del manual de demostración. Equipo ficticio, contenido original, creado para el proyecto Taller. —", SMALL)]

doc.build(E)
print("escrito", OUT)
