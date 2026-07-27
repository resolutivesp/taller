#!/usr/bin/env python3
"""Generates demo/demo-manual.pdf — an ORIGINAL, fictional service manual used to
demo Taller without copyright issues. The "OpenMed SP-100" does not exist.
Content written for this project; licensed like the repo (Apache-2.0)."""

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, PageBreak)

OUT = "/root/work/taller/demo/demo-manual.pdf"

styles = getSampleStyleSheet()
H1 = ParagraphStyle('H1x', parent=styles['Heading1'], fontSize=17, spaceAfter=8, textColor=colors.HexColor('#0e7c72'))
H2 = ParagraphStyle('H2x', parent=styles['Heading2'], fontSize=13, spaceAfter=6, textColor=colors.HexColor('#0e7c72'))
BODY = ParagraphStyle('Bodyx', parent=styles['BodyText'], fontSize=10, leading=14)
WARN = ParagraphStyle('Warnx', parent=BODY, backColor=colors.HexColor('#fff3cd'),
                      borderPadding=6, borderColor=colors.HexColor('#d9a706'), borderWidth=1)
SMALL = ParagraphStyle('Smallx', parent=BODY, fontSize=8.5, textColor=colors.grey)

def T(data, widths=None, header=True):
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#b8c4cc')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]
    if header:
        style += [('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0e7c72')),
                  ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                  ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold')]
    t.setStyle(TableStyle(style))
    return t

def P(text, style=BODY):
    return Paragraph(text, style)

doc = SimpleDocTemplate(OUT, pagesize=A4, topMargin=18*mm, bottomMargin=16*mm,
                        leftMargin=18*mm, rightMargin=18*mm,
                        title="SP-100 Portable Suction Pump — Service Manual (DEMO)",
                        author="Taller project (fictional demo device)")

E = []

# ---- p1 cover ----
E += [Spacer(1, 30*mm),
      P("OpenMed Instruments (fictional)", SMALL),
      P("SP-100 Portable Suction Pump", ParagraphStyle('T', parent=H1, fontSize=26, leading=30)),
      P("SERVICE MANUAL", ParagraphStyle('T2', parent=H1, fontSize=18)),
      Spacer(1, 8*mm),
      P("Document SP100-SM-EN · Revision 2.1", BODY),
      Spacer(1, 14*mm),
      P("<b>DEMO MANUAL.</b> This is an original, fictional document created to demonstrate "
        "the Taller app. The device does not exist. Do not use for real maintenance. "
        "For real work, import the manufacturer's manual of your actual equipment.", WARN),
      PageBreak()]

# ---- p2 contents ----
E += [P("Contents", H1),
      T([["Section", "Page"],
         ["1. Safety warnings", "3"],
         ["2. Technical specifications", "4"],
         ["3. Device overview", "5"],
         ["4. Principle of operation", "6"],
         ["5. Error codes", "7"],
         ["6. Troubleshooting — suction problems", "8"],
         ["7. Troubleshooting — power and motor", "9"],
         ["8. Troubleshooting — overheating and noise", "10"],
         ["9. Preventive maintenance schedule", "11"],
         ["10. Cleaning and disinfection", "12"],
         ["11. Spare parts list", "13"],
         ["12. Vacuum test and calibration", "14"]], widths=[120*mm, 30*mm]),
      PageBreak()]

# ---- p3 safety ----
E += [P("1. Safety warnings", H1),
      P("<b>WARNING — Electrical hazard.</b> Disconnect the mains plug before opening the housing. "
        "Capacitor C4 can hold charge for up to 60 seconds after power-off. Wait one minute "
        "before touching the motor driver board.", WARN),
      Spacer(1, 4),
      P("<b>WARNING — Biohazard.</b> The collection jar, lid, float valve and patient tubing must be "
        "treated as contaminated. Wear gloves. Disinfect before any service intervention (see section 10).", WARN),
      Spacer(1, 4),
      P("<b>CAUTION.</b> Never run the pump without the bacterial filter installed. Fluid ingress into "
        "the pump head is the most common cause of premature diaphragm failure.", WARN),
      Spacer(1, 6),
      P("Only trained biomedical technicians should service this device. After any repair, perform the "
        "vacuum test of section 12 before returning the unit to clinical use. Never bypass the overflow "
        "protection float or the thermal cut-out switch.", BODY),
      PageBreak()]

# ---- p4 specs ----
E += [P("2. Technical specifications", H1),
      T([["Parameter", "Value"],
         ["Mains supply", "100–240 V AC, 50/60 Hz, 90 W"],
         ["Internal battery", "12 V 2.6 Ah sealed lead-acid, 45 min autonomy"],
         ["Maximum vacuum", "−80 kPa (−600 mmHg) ± 5 %"],
         ["Free air flow", "30 L/min minimum at pump inlet"],
         ["Vacuum regulator range", "−10 to −80 kPa, continuous"],
         ["Collection jar", "1.0 L polycarbonate, autoclavable at 121 °C"],
         ["Bacterial filter", "Hydrophobic 0.2 µm, single use, part FT-020"],
         ["Fuse", "T2AL 250 V, 5×20 mm, two units on mains inlet"],
         ["Pump type", "Oil-free double-diaphragm, brushless DC motor"],
         ["Duty cycle", "Continuous (thermal cut-out at 70 °C)"],
         ["Weight / dimensions", "4.8 kg · 330 × 210 × 240 mm"],
         ["Noise level", "< 55 dB(A) at 1 m"]], widths=[65*mm, 95*mm]),
      PageBreak()]

# ---- p5 overview ----
E += [P("3. Device overview", H1),
      P("Main assemblies, from the patient side to the mains inlet:", BODY),
      T([["Ref", "Assembly", "Notes"],
         ["A1", "Collection jar with float valve", "Float closes suction when jar is full (overflow protection)"],
         ["A2", "Bacterial filter FT-020", "Between jar lid and pump inlet; replace if wet or discoloured"],
         ["A3", "Vacuum regulator and gauge", "Rotary valve; gauge marked in kPa and mmHg"],
         ["A4", "Pump head (double diaphragm)", "Two valve plates, two diaphragms; kit PK-110"],
         ["A5", "BLDC motor and driver board", "Hall-sensor commutated; connector J3, 6-pin"],
         ["A6", "Main board (PSU + control)", "Fuses F1/F2, capacitor C4, error LED display"],
         ["A7", "Battery pack", "Connector J5; replace every 24 months"],
         ["A8", "Mains inlet module", "IEC C14 with switch and fuse drawer"]], widths=[12*mm, 58*mm, 90*mm]),
      P("The housing opens with four Torx T15 screws under the rubber feet. The pump head is mounted "
        "on two anti-vibration studs; do not overtighten (0.8 N·m).", BODY),
      PageBreak()]

# ---- p6 operation ----
E += [P("4. Principle of operation", H1),
      P("The brushless motor drives an eccentric that flexes two diaphragms in opposition. Reed valves "
        "on the valve plates rectify the airflow, producing vacuum at the inlet port. The control board "
        "regulates motor speed to hold the vacuum selected on the regulator, monitors motor current, "
        "battery voltage and pump-head temperature, and reports faults as error codes E1–E8 on the "
        "front panel display.", BODY),
      P("When mains power is present the battery charges at 0.4 A; the unit switches to battery "
        "automatically on mains failure. If jar overflow occurs, the float valve seals the lid and "
        "vacuum rises sharply while flow stops — this protects the filter and pump, and typically "
        "triggers error E5 (blocked inlet).", BODY),
      P("Typical current draw at −60 kPa is 1.1–1.4 A from the 12 V rail. A reading above 2.0 A "
        "with low vacuum indicates a mechanical fault in the pump head (see section 6).", BODY),
      PageBreak()]

# ---- p7 error codes ----
E += [P("5. Error codes", H1),
      P("Codes appear on the front display. Press and hold MODE for 3 s to show the last five stored "
        "codes with hour-meter stamps.", BODY),
      T([["Code", "Meaning", "First actions"],
         ["E1", "Mains fuse fault / no mains detected", "Check fuses F1 and F2 (T2AL 250 V) in the inlet drawer; check mains cable and socket"],
         ["E2", "Battery low (< 10.8 V)", "Connect mains 8 h; if E2 returns quickly, test battery capacity, replace pack (24 months typical life)"],
         ["E3", "Motor stall / overcurrent", "Disconnect pump head cam; if motor spins free, inspect diaphragms and valve plates for fluid ingress; check connector J3 seating"],
         ["E4", "Pump-head over-temperature (> 70 °C)", "Let unit cool 30 min; clean air vents; check fan spins; verify duty conditions (ambient < 40 °C)"],
         ["E5", "Blocked inlet / no flow with high vacuum", "Empty jar (float may be sealed); replace bacterial filter FT-020 if wet; check tubing for kinks"],
         ["E6", "Vacuum sensor out of range", "Check sensor hose to main board port P1 for cracks; re-zero per section 12; replace sensor S2 if drift > ±3 kPa"],
         ["E7", "Hall sensor / commutation fault", "Re-seat connector J3; measure 5 V at J3 pin 1; replace motor if any Hall line stays high/low while rotating by hand"],
         ["E8", "Control board internal fault", "Power-cycle once; if E8 persists, replace main board MB-100 — do not attempt component-level repair on site"]],
        widths=[12*mm, 52*mm, 96*mm]),
      PageBreak()]

# ---- p8 suction troubleshooting ----
E += [P("6. Troubleshooting — suction problems", H1),
      P("6.1 No suction at the patient tube", H2),
      P("Work from the patient side towards the pump: "
        "(1) Jar lid not seated or gasket damaged — refit lid, inspect gasket G-101 for cuts; "
        "(2) Float valve stuck closed after overflow — empty jar, rinse float, verify free movement; "
        "(3) Bacterial filter FT-020 wet or clogged — replace, never wash; "
        "(4) Tubing kinked or connectors cracked — replace tubing set TS-210; "
        "(5) Regulator fully open to atmosphere — rotate clockwise to increase vacuum; "
        "(6) If still no suction with the inlet blocked by a finger and gauge at zero: pump head fault — see 6.3.", BODY),
      P("6.2 Weak suction (vacuum below −40 kPa with inlet blocked)", H2),
      P("Most common causes in field units: leaking jar gasket (replace G-101), perished internal "
        "silicone hose between filter port and pump inlet (replace, 6×9 mm silicone), and worn "
        "diaphragms after ~3,000 h (fit pump kit PK-110). Soapy water on joints shows leaks as bubbles "
        "while running. Verify the gauge itself against a known-good gauge before replacing parts.", BODY),
      P("6.3 Pump head service", H2),
      P("Remove four M4 screws on the head cover. Mark diaphragm orientation before removal. Inspect "
        "reed valves for corrosion or debris; clean seats with isopropyl alcohol only. Fit new "
        "diaphragms with the kit's new screws, torque 0.8 N·m in a cross pattern. Run 5 min and "
        "perform the section 12 vacuum test.", BODY),
      PageBreak()]

# ---- p9 power/motor ----
E += [P("7. Troubleshooting — power and motor", H1),
      P("7.1 Unit completely dead", H2),
      P("Check in order: mains socket live (test lamp); mains cable continuity; fuses F1/F2 in the "
        "inlet drawer — replace only with T2AL 250 V; inlet switch continuity; 12 V present at battery "
        "connector J5 (battery may be deeply discharged — unit can run from mains with battery "
        "disconnected for diagnosis). A blown fuse that blows again immediately indicates a shorted "
        "rectifier on the main board or a seized motor — do not keep replacing fuses.", BODY),
      P("7.2 Runs on mains but not on battery", H2),
      P("Measure battery open-circuit voltage: below 11.5 V after 8 h charging means the pack is worn "
        "— replace (part BT-126). Check the 3 A blade fuse on the battery lead. If charging LED never "
        "lights, measure 13.8 V at J5 with mains on; absent → charger section fault on main board.", BODY),
      P("7.3 Motor tries to start then stops (often with E3)", H2),
      P("Fluid ingress gums the pump head: remove head cover and check for liquid. Turn the eccentric "
        "by hand — it must rotate smoothly. Verify J3 connector fully latched (vibration loosens it). "
        "Measure motor phase resistance: 0.8–1.2 Ω between any two phase pins; open or shorted "
        "windings → replace motor MT-100.", BODY),
      PageBreak()]

# ---- p10 overheat/noise ----
E += [P("8. Troubleshooting — overheating and noise", H1),
      P("8.1 Overheating / repeated E4", H2),
      P("Clean dust from the vent grilles and fan with a dry brush. Confirm the fan runs above "
        "−30 kPa load. Check ambient temperature and that the unit is not enclosed in a cabinet. "
        "A pump head rebuilt without the anti-vibration studs, or run continuously at maximum vacuum "
        "in ambient above 40 °C, will cycle on the thermal cut-out — this is protection, not a fault.", BODY),
      P("8.2 Excessive noise or vibration", H2),
      P("Rattling: loose housing screws or cracked anti-vibration studs (replace in pairs, part "
        "AV-014). Knocking at low vacuum: worn eccentric bearing — replace with pump kit PK-110. "
        "High-pitched whine: reed valve chatter, usually debris on a valve seat — clean per 6.3. "
        "After any noise repair, run at −60 kPa for 10 minutes and confirm temperature stays below "
        "60 °C at the head.", BODY),
      P("8.3 Display dead but pump runs", H2),
      P("Re-seat display ribbon cable at connector J7. If segments are missing, replace display module "
        "DP-100; the pump remains safe to use short-term — vacuum is still regulated mechanically.", BODY),
      PageBreak()]

# ---- p11 PM schedule ----
E += [P("9. Preventive maintenance schedule", H1),
      T([["Interval", "Task", "Parts"],
         ["Daily (user)", "Empty and disinfect jar; check filter dry; test suction with finger over inlet", "—"],
         ["Monthly", "Inspect tubing and lid gasket; clean vents; test battery runtime ≥ 30 min", "G-101 if damaged"],
         ["6 months", "Vacuum test (section 12); check fuse drawer; verify float valve free", "—"],
         ["12 months", "Replace bacterial filter stock rotation; battery capacity test; electrical safety test (Class II leakage limits)", "FT-020"],
         ["24 months", "Replace battery pack; replace jar gasket set; consider diaphragm kit if > 3,000 h", "BT-126, G-101, PK-110"]],
        widths=[26*mm, 92*mm, 42*mm]),
      P("Record every intervention in your maintenance log with date, hour-meter reading and parts "
        "used. Units with complete logs show roughly half the unplanned downtime of unlogged units in "
        "our field data.", BODY),
      PageBreak()]

# ---- p12 cleaning ----
E += [P("10. Cleaning and disinfection", H1),
      P("Jar, lid and float: wash with warm water and detergent, then disinfect (chlorine 0.5 % for "
        "10 min or autoclave 121 °C / 15 min — polycarbonate jar only, check for crazing after "
        "repeated cycles). Tubing sets are single-patient use where supplies allow; otherwise "
        "disinfect chemically, never autoclave PVC tubing.", BODY),
      P("Housing: wipe with 70 % isopropyl alcohol. Never spray liquids at the vents. The bacterial "
        "filter FT-020 cannot be cleaned or reused: a wet filter both blocks flow (E5) and loses its "
        "barrier function.", BODY),
      P("Before opening the unit for service, run 30 s with a jar of disinfectant connected, wipe "
        "external surfaces, and wear gloves throughout.", BODY),
      PageBreak()]

# ---- p13 parts ----
E += [P("11. Spare parts list", H1),
      T([["Part no.", "Description", "Typical replacement"],
         ["FT-020", "Bacterial filter 0.2 µm hydrophobic", "When wet/discoloured; 12-month stock rotation"],
         ["G-101", "Jar lid gasket, silicone", "On damage; every 24 months"],
         ["TS-210", "Tubing set, patient side, 2 m", "On damage or per hygiene policy"],
         ["PK-110", "Pump kit: 2 diaphragms, 2 valve plates, screws", "~3,000 h or on fluid ingress"],
         ["BT-126", "Battery 12 V 2.6 Ah SLA", "24 months"],
         ["MT-100", "BLDC motor with Hall sensors", "On winding/Hall failure"],
         ["MB-100", "Main board (PSU + control)", "On E8 persistent"],
         ["DP-100", "Display module", "On display failure"],
         ["AV-014", "Anti-vibration studs (pair)", "On cracking/noise"],
         ["FU-T2A", "Fuse T2AL 250 V 5×20 mm (×10)", "As needed — find root cause of repeat failures"]],
        widths=[22*mm, 84*mm, 54*mm]),
      P("Generic equivalents: the fuse, silicone hose (6×9 mm), and SLA battery are standard "
        "commodity parts available in most markets; match ratings exactly.", BODY),
      PageBreak()]

# ---- p14 calibration ----
E += [P("12. Vacuum test and calibration", H1),
      P("12.1 Performance test (after every repair)", H2),
      P("(1) Fit clean jar, dry filter, close inlet with the test cap. (2) Run at maximum: gauge must "
        "reach −75 kPa or better within 10 s. (3) Stop pump: vacuum must not fall more than 5 kPa in "
        "60 s (leak test). (4) Open regulator to −30 kPa: reading must hold ± 3 kPa for 5 min. "
        "(5) Free-flow: with inlet open, a 1 L jar fills with water lifted 0.5 m in under 25 s "
        "(≈ 30 L/min air equivalent).", BODY),
      P("12.2 Vacuum sensor re-zero", H2),
      P("With the unit off and inlet open to atmosphere, hold MODE + POWER for 5 s until 'CAL' shows, "
        "then press MODE once. The display shows '0.0'. If E6 persists after re-zero, replace sensor "
        "S2 on the main board (plug-in part, no soldering).", BODY),
      P("12.3 Electrical safety", H2),
      P("After any opening of the housing: Class II touch-current test per your local standard "
        "(IEC 62353 limits). Record results in the maintenance log.", BODY),
      Spacer(1, 8*mm),
      P("— End of demo manual. Fictional device, original content, created for the Taller project. —", SMALL)]

doc.build(E)
print("written", OUT)
