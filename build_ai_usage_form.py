from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


OUTPUT = "/Users/cadenshokat/Documents/Projects/webable/WebAble_AI_Usage_Approval_Form.docx"


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_border(cell, **edges):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge_name, edge_data in edges.items():
        tag = "w:{}".format(edge_name)
        edge = borders.find(qn(tag))
        if edge is None:
            edge = OxmlElement(tag)
            borders.append(edge)
        for key in ["val", "sz", "space", "color"]:
            if key in edge_data:
                edge.set(qn("w:{}".format(key)), str(edge_data[key]))


def set_cell_margins(cell, top=90, start=110, bottom=90, end=110):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for name, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn("w:" + name))
        if node is None:
            node = OxmlElement("w:" + name)
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def add_page_number(paragraph):
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = paragraph.add_run("Page ")
    run.font.size = Pt(8.5)
    run.font.color.rgb = RGBColor(89, 96, 105)
    fld_char1 = OxmlElement("w:fldChar")
    fld_char1.set(qn("w:fldCharType"), "begin")
    instr_text = OxmlElement("w:instrText")
    instr_text.set(qn("xml:space"), "preserve")
    instr_text.text = "PAGE"
    fld_char2 = OxmlElement("w:fldChar")
    fld_char2.set(qn("w:fldCharType"), "end")
    run._r.extend([fld_char1, instr_text, fld_char2])


def keep_with_next(paragraph):
    paragraph.paragraph_format.keep_with_next = True


def add_section_heading(doc, text):
    p = doc.add_paragraph(style="Heading 1")
    p.paragraph_format.space_before = Pt(8)
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.keep_with_next = True
    r = p.add_run(text)
    r.bold = True
    return p


def add_bullet(doc, lead, body):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.left_indent = Inches(0.23)
    p.paragraph_format.first_line_indent = Inches(-0.15)
    p.paragraph_format.space_after = Pt(1.5)
    p.paragraph_format.line_spacing = 1.0
    r = p.add_run(lead)
    r.bold = True
    p.add_run(body)
    return p


doc = Document()
section = doc.sections[0]
section.page_width = Inches(8.5)
section.page_height = Inches(11)
section.top_margin = Inches(0.55)
section.bottom_margin = Inches(0.55)
section.left_margin = Inches(0.68)
section.right_margin = Inches(0.68)
section.header_distance = Inches(0.25)
section.footer_distance = Inches(0.25)

styles = doc.styles
normal = styles["Normal"]
normal.font.name = "Aptos"
normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Aptos")
normal.font.size = Pt(10.5)
normal.font.color.rgb = RGBColor(28, 32, 36)
normal.paragraph_format.space_after = Pt(4)
normal.paragraph_format.line_spacing = 1.04

title_style = styles["Title"]
title_style.font.name = "Aptos Display"
title_style._element.rPr.rFonts.set(qn("w:eastAsia"), "Aptos Display")
title_style.font.size = Pt(19)
title_style.font.bold = True
title_style.font.color.rgb = RGBColor(0, 0, 0)
title_ppr = title_style.element.get_or_add_pPr()
title_border = title_ppr.find(qn("w:pBdr"))
if title_border is not None:
    title_ppr.remove(title_border)

heading1 = styles["Heading 1"]
heading1.font.name = "Aptos Display"
heading1._element.rPr.rFonts.set(qn("w:eastAsia"), "Aptos Display")
heading1.font.size = Pt(12)
heading1.font.bold = True
heading1.font.color.rgb = RGBColor(0, 0, 0)

header = section.header
hp = header.paragraphs[0]
hp.text = "WEBABLE   |   CIS CEN 4914 SENIOR DESIGN"
hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
for r in hp.runs:
    r.font.name = "Aptos"
    r.font.size = Pt(8)
    r.font.bold = True
    r.font.color.rgb = RGBColor(60, 78, 104)

footer = section.footer
fp = footer.paragraphs[0]
fp.add_run("AI Usage Approval Form   •   Fall 2026")
for r in fp.runs:
    r.font.name = "Aptos"
    r.font.size = Pt(8.5)
    r.font.color.rgb = RGBColor(89, 96, 105)
tab_stops = fp.paragraph_format.tab_stops
tab_stops.add_tab_stop(Inches(6.15))
fp.add_run("\t")
add_page_number(fp)

p = doc.add_paragraph(style="Title")
p.alignment = WD_ALIGN_PARAGRAPH.LEFT
p.paragraph_format.space_after = Pt(1)
p.add_run("WebAble Artificial Intelligence Usage Approval Form")

p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(7)
r = p.add_run("Faculty advisor review and approval of the team’s planned use of artificial intelligence")
r.font.size = Pt(10.5)
r.font.color.rgb = RGBColor(79, 86, 94)

meta = doc.add_table(rows=4, cols=2)
meta.alignment = WD_TABLE_ALIGNMENT.CENTER
meta.autofit = False
meta.columns[0].width = Inches(3.5)
meta.columns[1].width = Inches(3.5)
meta_data = [
    ("Course", "CIS CEN 4914 Senior Design"),
    ("Term", "Fall 2026"),
    ("Team", "WebAble"),
    ("Faculty advisor", "Dr. Dung Tran"),
]
for row, (label, value) in zip(meta.rows, meta_data):
    for cell in row.cells:
        set_cell_margins(cell, top=65, bottom=65, start=100, end=100)
        set_cell_border(cell, bottom={"val": "single", "sz": "5", "color": "D9D9D9"})
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    set_cell_shading(row.cells[0], "F3F6FA")
    p0 = row.cells[0].paragraphs[0]
    p0.paragraph_format.space_after = Pt(0)
    r0 = p0.add_run(label)
    r0.bold = True
    r0.font.size = Pt(9.5)
    p1 = row.cells[1].paragraphs[0]
    p1.paragraph_format.space_after = Pt(0)
    r1 = p1.add_run(value)
    r1.font.size = Pt(9.5)

p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(5)
p.paragraph_format.space_after = Pt(2)
r = p.add_run("Team members")
r.bold = True
p.add_run(": Rainier Joshua Tabelon, Caden Shokat, Fernando Fiallos, Belal Mansour, and Katherine Boetig")

add_section_heading(doc, "Purpose")
p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(3)
p.add_run(
    "This form documents WebAble’s planned use of artificial intelligence as both a feature of the product and a development tool. "
    "The team requests the faculty advisor’s approval of the scope and safeguards below."
)

add_section_heading(doc, "Planned Use of Artificial Intelligence")
add_bullet(
    doc,
    "AI within the WebAble product. ",
    "WebAble will use AI and machine learning to infer accessibility needs from user interactions and preferences. "
    "At the user’s request, a language model may generate adaptations to the presentation of a website while preserving its underlying content and functionality."
)
add_bullet(
    doc,
    "AI for development and planning. ",
    "The team plans to use tools such as ChatGPT Codex and Claude Code for code generation, project scaffolding, feature planning, unit-test generation, and front-end design iteration. "
    "On-device models, including Gemini Nano or comparable alternatives, may be evaluated for the product."
)

add_section_heading(doc, "Expected Extent")
p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(3)
p.add_run(
    "Including product functionality and development support, the team estimates that AI-assisted or AI-generated work may account for approximately 80 percent of the project. "
    "This is an estimate of the planned scope, not a substitute for team review, understanding, testing, or responsibility."
)

add_section_heading(doc, "Limits and Team Responsibilities")
limits = [
    "AI will not be used to generate graded written deliverables, including the project proposal, technical report, presentation content, or team contract.",
    "No team member will commit code that they cannot explain, regardless of how the code was produced.",
    "Team members will review and test AI-assisted code before it is merged into the project.",
    "The team will use GitHub, pull-request review, automated linting, and tests to maintain accountability for submitted code.",
    "Secrets will not be entered into AI tools or committed to the repository. User data will be minimized, with a preference for local and on-device processing."
]
for item in limits:
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.left_indent = Inches(0.23)
    p.paragraph_format.first_line_indent = Inches(-0.15)
    p.paragraph_format.space_after = Pt(1.3)
    p.paragraph_format.line_spacing = 1.0
    p.add_run(item)

add_section_heading(doc, "Advisor Approval")
p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(5)
p.add_run("By signing below, I acknowledge and approve the WebAble team’s planned use of artificial intelligence as described in this form.")

decision = doc.add_table(rows=1, cols=2)
decision.alignment = WD_TABLE_ALIGNMENT.CENTER
decision.autofit = False
decision.columns[0].width = Inches(3.45)
decision.columns[1].width = Inches(3.55)
for cell in decision.rows[0].cells:
    set_cell_margins(cell, top=60, bottom=60, start=50, end=50)
    set_cell_border(cell, bottom={"val": "nil"})
    cell.paragraphs[0].paragraph_format.space_after = Pt(0)
decision.cell(0, 0).paragraphs[0].add_run("☐  Approved as described")
decision.cell(0, 1).paragraphs[0].add_run("☐  Approval withheld pending revision")

p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(8)
p.paragraph_format.space_after = Pt(7)
p.add_run("Advisor signature: ____________________________________    Date: __________________")

p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(0)
p.add_run("Printed name: Dr. Dung Tran").bold = True

doc.save(OUTPUT)
print(OUTPUT)
