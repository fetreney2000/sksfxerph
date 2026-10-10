// @vitest-environment jsdom
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseDocumentXml, parseDocx } from "@/lib/import/docx";

/**
 * Importing an existing .docx.
 *
 * The parser is heuristic on purpose — Word documents disagree about labels —
 * so what is asserted here is that the school's own form reads correctly and
 * that a file it cannot read says so. Getting a field wrong costs the teacher
 * a correction; throwing on a file they chose would cost them the feature.
 */
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/**
 * A paragraph. Word always wraps text in `<w:t>` — even a single word, and
 * even when the run is the whole paragraph — so a bare text node here would
 * be a fixture that no real document produces.
 */
const para = (...parts: string[]) =>
  `<w:p>${parts.map((t) => `<w:t>${t}</w:t>`).join("")}</w:p>`;
const cell = (...paragraphs: string[]) => `<w:tc>${paragraphs.join("")}</w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.join("")}</w:tr>`;
const tbl = (...rows: string[]) => `<w:tbl>${rows.join("")}</w:tbl>`;
const doc = (body: string) => `<w:document ${NS}><w:body>${body}</w:body></w:document>`;

/** The school's own form, as it comes out of Word. */
const SCHOOL_FORM = doc(
  tbl(
    row(cell(para("NAMA")), cell(para("KARTINI SERAH"))),
    row(cell(para("Masa Mula")), cell(para("7:20 am"))),
    row(cell(para("Masa Tamat")), cell(para("12:40 pm"))),
    row(cell(para("Tema/Bidang/")), cell(para("Program Pengoperasian Sekolah"))),
    row(
      cell(para("Objektif")),
      cell(
        para("Murid dapat menyesuaikan diri dengan persekitaran sekolah baharu"),
        para("serta menunjukkan sikap berani dan yakin."),
      ),
    ),
    row(cell(para("Kriteria Kejayaan")), cell(para("Murid menunjukkan penglibatan aktif."))),
    row(
      cell(para("Aktiviti PdPC")),
      cell(
        para("Minggu Pengoperasian Sekolah"),
        para("Permainan Dalaman"),
        para("- Catur"),
        para("- Congkak"),
        para("Rehat Tahap 1"),
      ),
    ),
    row(cell(para("Refleksi")), cell(para("PnP ditangguhkan ke minggu hadapan."))),
  ),
);

describe("parseDocumentXml — the school's form", () => {
  it("reads every field the form carries", () => {
    const { payload } = parseDocumentXml(SCHOOL_FORM);
    expect(payload.standard_kandungan).toBe("");
    expect(payload.objektif).toBe(
      "Murid dapat menyesuaikan diri dengan persekitaran sekolah baharu serta menunjukkan sikap berani dan yakin.",
    );
    expect(payload.kriteria_kejayaan).toBe("Murid menunjukkan penglibatan aktif.");
    expect(payload.refleksi).toBe("PnP ditangguhkan ke minggu hadapan.");
    expect(payload.fasa_tema).toBe("Program Pengoperasian Sekolah");
  });

  it("splits the activity list on paragraphs, not on the cell", () => {
    // Reading the cell as one string would collapse five activities into one
    // very long line — the difference the teacher would notice first.
    const { payload } = parseDocumentXml(SCHOOL_FORM);
    expect(payload.aktiviti.map((a) => a.nama)).toEqual([
      "Minggu Pengoperasian Sekolah",
      "Permainan Dalaman",
      "Catur",
      "Congkak",
      "Rehat Tahap 1",
    ]);
  });

  it("takes a hyphen for the indent the printed form uses", () => {
    const { payload } = parseDocumentXml(SCHOOL_FORM);
    expect(payload.aktiviti.map((a) => a.sub)).toEqual([false, false, true, true, false]);
  });

  it("reads Masa Mula and Masa Tamat as times the penyunting accepts", () => {
    const { slotTime, slotTimeEnd } = parseDocumentXml(SCHOOL_FORM);
    expect(slotTime).toBe("07:20");
    expect(slotTimeEnd).toBe("12:40");
  });

  it("joins a value split across runs without inventing a space", () => {
    // Word splits a word across <w:t> elements the moment a spell-check
    // underline lands on it; a separator would print "Pengaj rajaran".
    const split = doc(
      tbl(row(cell(para("Standard Kan", "dungan")), cell(para("Nombor", " hingga 100,000")))),
    );
    const { payload } = parseDocumentXml(split);
    expect(payload.standard_kandungan).toBe("Nombor hingga 100,000");
  });

  it("reads a freehand document by label, when there is no table", () => {
    const freehand = doc(
      `${para("Objektif: Murid dapat mengenal pasti lima maklumat penting.")}${para("Refleksi: Tiga murid tercicir.")}`,
    );
    const { payload } = parseDocumentXml(freehand);
    expect(payload.objektif).toBe("Murid dapat mengenal pasti lima maklumat penting.");
    expect(payload.refleksi).toBe("Tiga murid tercicir.");
  });

  it("returns an empty payload rather than throwing on an unrecognised form", () => {
    // A wrong file should cost the teacher a glance, not the feature.
    const { payload } = parseDocumentXml(doc(para("Sebarang dokumen yang bukan RPH.")));
    expect(payload.aktiviti).toEqual([]);
    expect(payload.objektif).toBe("");
  });

  it("ignores prefix differences between Word producers", () => {
    // Not every producer uses the `w:` prefix, and matching on the prefix
    // would find nothing in a document that is perfectly valid.
    const other =
      '<x:document xmlns:x="urn:example"><x:body>' +
      "<x:tbl><x:tr><x:tc><x:p><x:t>Objektif</x:t></x:p></x:tc>" +
      "<x:tc><x:p><x:t>Tajuk bebas</x:t></x:p></x:tc></x:tr></x:tbl>" +
      "</x:body></x:document>";
    expect(parseDocumentXml(other).payload.objektif).toBe("Tajuk bebas");
  });
});

describe("parseDocx — the zip around it", () => {
  const asFile = (xml: string) =>
    new File([zipSync({ "word/document.xml": strToU8(xml) })], "rph.docx");

  it("reads a real .docx archive", async () => {
    const imported = await parseDocx(asFile(SCHOOL_FORM));
    expect(imported.payload.kriteria_kejayaan).toBe("Murid menunjukkan penglibatan aktif.");
    expect(imported.slotTime).toBe("07:20");
  });

  it("says so plainly when a file is not a .docx", async () => {
    // A .docx is a zip; anything else must be reported as a fact about the
    // file, not swallowed or blamed on the teacher.
    const notADocx = new File(["PK not really"], "rph.docx");
    await expect(parseDocx(notADocx)).rejects.toThrow(/bukan dokumen \.docx/);
  });
});
