import PDFDocument from 'pdfkit';

export interface JdPdfData {
  jobTitle: string;
  department: string;
  property: string;
  positions: number;
  // Variable (admin-configured) fields
  employmentType?: string;
  experience?: string;
  salaryRange?: string;
  reportingTo?: string;
  location?: string;
  summary?: string;
  responsibilities?: string[];
  requirements?: string[];
  generatedDate: string;
}

const BRAND = '#2563eb';
const DARK = '#111827';
const GRAY = '#6b7280';
const LIGHT = '#f3f4f6';

export function generateJdPdf(data: JdPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 54 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 54;
    const right = doc.page.width - 54;
    const width = right - left;

    // ─── Header ───
    doc.rect(0, 0, doc.page.width, 96).fill(BRAND);
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#ffffff').text('SaltStayz', left, 26);
    doc.fontSize(9).font('Helvetica').fillColor('#dbeafe').text('HOSPITALITY PVT. LTD.', left, 54);
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#ffffff')
      .text('JOB DESCRIPTION', right - 200, 34, { width: 200, align: 'right' });
    doc.fontSize(8).font('Helvetica').fillColor('#dbeafe')
      .text(data.generatedDate, right - 200, 56, { width: 200, align: 'right' });

    // ─── Title ───
    doc.y = 118;
    doc.fontSize(20).font('Helvetica-Bold').fillColor(DARK).text(data.jobTitle, left);
    doc.fontSize(10).font('Helvetica').fillColor(GRAY)
      .text(`${data.department || '—'}  ·  ${data.location || data.property || '—'}`, left, doc.y + 2);

    // ─── Details box ───
    doc.moveDown(0.8);
    const boxY = doc.y;
    const boxH = 64;
    doc.roundedRect(left, boxY, width, boxH, 6).fill(LIGHT);
    const cellW = width / 4;
    const detail = (label: string, value: string, i: number) => {
      const x = left + 16 + i * cellW;
      doc.fontSize(8).font('Helvetica').fillColor(GRAY).text(label, x, boxY + 14, { width: cellW - 16 });
      doc.fontSize(10).font('Helvetica-Bold').fillColor(DARK).text(value || '—', x, boxY + 30, { width: cellW - 16 });
    };
    detail('Openings', String(data.positions ?? 1), 0);
    detail('Employment Type', data.employmentType || 'Full-time', 1);
    detail('Experience', data.experience || '—', 2);
    detail('Reports To', data.reportingTo || '—', 3);
    doc.y = boxY + boxH + 18;

    const section = (title: string) => {
      doc.fontSize(12).font('Helvetica-Bold').fillColor(BRAND).text(title, left, doc.y);
      doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).strokeColor('#e5e7eb').lineWidth(1).stroke();
      doc.moveDown(0.6);
    };

    if (data.summary?.trim()) {
      section('About the Role');
      doc.fontSize(10).font('Helvetica').fillColor(DARK).text(data.summary.trim(), left, doc.y, { width, lineGap: 3 });
      doc.moveDown(1);
    }

    const bulletList = (title: string, items?: string[]) => {
      const list = (items || []).map(s => s.trim()).filter(Boolean);
      if (!list.length) return;
      section(title);
      list.forEach((item) => {
        const y = doc.y;
        doc.circle(left + 3, y + 6, 1.6).fill(BRAND);
        doc.fontSize(10).font('Helvetica').fillColor(DARK).text(item, left + 14, y, { width: width - 14, lineGap: 2 });
        doc.moveDown(0.35);
      });
      doc.moveDown(0.6);
    };

    bulletList('Key Responsibilities', data.responsibilities);
    bulletList('Requirements & Qualifications', data.requirements);

    if (data.salaryRange?.trim()) {
      section('Compensation (CTC)');
      doc.fontSize(10).font('Helvetica').fillColor(DARK).text(data.salaryRange.trim(), left, doc.y, { width });
      doc.moveDown(1);
    }

    // ─── Footer ───
    const footerY = doc.page.height - 46;
    doc.fontSize(7.5).font('Helvetica-Oblique').fillColor(GRAY)
      .text('SaltStayz is an equal-opportunity employer. To apply, contact the Human Resources department.',
        left, footerY, { width, align: 'center' });
    doc.fontSize(7).font('Helvetica').fillColor(GRAY)
      .text('SaltStayz Hospitality Pvt. Ltd.  |  Gurugram, India  |  www.saltstayz.com  |  hr@saltstayz.com',
        left, footerY + 13, { width, align: 'center' });

    doc.end();
  });
}
