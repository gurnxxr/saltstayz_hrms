import PDFDocument from 'pdfkit';
import type { PayslipBreakdown } from './payslip.calc';

export interface PayslipPdfData {
  employeeName: string;
  employeeCode: string;
  designation: string;
  department: string;
  branch: string;
  monthLabel: string;   // e.g. "June 2026"
  payDate: string;      // formatted
  breakdown: PayslipBreakdown;
}

const BRAND = '#2563eb';
const DARK = '#111827';
const GRAY = '#6b7280';
const LINE = '#e5e7eb';
const LIGHT = '#f3f4f6';

const inr = (n: number) =>
  'INR ' + Math.round(n).toLocaleString('en-IN');

export function generatePayslipPdf(data: PayslipPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const b = data.breakdown;
    const pageLeft = 50;
    const pageRight = doc.page.width - 50;
    const contentW = pageRight - pageLeft;

    // ─── Header ───
    doc.rect(0, 0, doc.page.width, 92).fill(BRAND);
    doc.fontSize(24).font('Helvetica-Bold').fillColor('#ffffff').text('SaltStayz', pageLeft, 24);
    doc.fontSize(9).font('Helvetica').fillColor('#dbeafe').text('HOSPITALITY PVT. LTD.', pageLeft, 54);
    doc.fontSize(8).fillColor('#dbeafe')
      .text('4th Floor, Tower B, Cyber Hub, DLF Phase 2,', pageLeft, 68)
      .text('Gurugram, Haryana 122002, India', pageLeft, 79);

    doc.fontSize(13).font('Helvetica-Bold').fillColor('#ffffff')
      .text('PAYSLIP', pageRight - 200, 30, { width: 200, align: 'right' });
    doc.fontSize(9).font('Helvetica').fillColor('#dbeafe')
      .text(data.monthLabel, pageRight - 200, 50, { width: 200, align: 'right' });

    // ─── Employee summary box ───
    let y = 112;
    doc.roundedRect(pageLeft, y, contentW, 78, 6).fill(LIGHT);
    const col1 = pageLeft + 18;
    const col2 = pageLeft + contentW / 2 + 10;
    const cell = (label: string, value: string, x: number, yy: number) => {
      doc.fontSize(8).font('Helvetica').fillColor(GRAY).text(label, x, yy);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(DARK).text(value || '-', x, yy + 11);
    };
    cell('Employee Name', data.employeeName, col1, y + 12);
    cell('Employee Code', data.employeeCode, col2, y + 12);
    cell('Designation', data.designation, col1, y + 44);
    cell('Pay Date', data.payDate, col2, y + 44);
    doc.fontSize(8).font('Helvetica').fillColor(GRAY)
      .text(`${data.department || '-'}  |  ${data.branch || '-'}`, pageLeft, y + 84, { width: contentW });

    y += 104;

    // ─── Two-column tables: Earnings (left) / Deductions (right) ───
    const gap = 16;
    const colW = (contentW - gap) / 2;
    const leftX = pageLeft;
    const rightX = pageLeft + colW + gap;

    const tableHeader = (title: string, x: number, yy: number) => {
      doc.rect(x, yy, colW, 22).fill(BRAND);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff').text(title, x + 10, yy + 7);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff')
        .text('Amount', x + colW - 90, yy + 7, { width: 80, align: 'right' });
    };

    const rows = (items: [string, number][], x: number, startY: number) => {
      let ry = startY;
      items.forEach(([label, val], i) => {
        if (i % 2 === 1) doc.rect(x, ry, colW, 20).fill('#fafafa');
        doc.fontSize(9).font('Helvetica').fillColor(DARK).text(label, x + 10, ry + 6, { width: colW - 100 });
        doc.fontSize(9).font('Helvetica').fillColor(DARK)
          .text(inr(val), x + colW - 90, ry + 6, { width: 80, align: 'right' });
        ry += 20;
      });
      return ry;
    };

    const totalRow = (label: string, val: number, x: number, yy: number) => {
      doc.rect(x, yy, colW, 22).fill('#eef2ff');
      doc.fontSize(9).font('Helvetica-Bold').fillColor(BRAND).text(label, x + 10, yy + 7);
      doc.fontSize(9).font('Helvetica-Bold').fillColor(BRAND)
        .text(inr(val), x + colW - 90, yy + 7, { width: 80, align: 'right' });
      return yy + 22;
    };

    // Earnings
    tableHeader('EARNINGS', leftX, y);
    let ly = rows(
      [
        ['Basic', b.basic],
        ['HRA', b.hra],
        ['Other Allowance', b.other_allowance],
        ['PLI (Variable Pay)', b.pli],
      ],
      leftX, y + 22,
    );
    ly = totalRow('Gross Earnings', b.gross_earnings, leftX, ly);

    // Deductions
    tableHeader('DEDUCTIONS', rightX, y);
    let ry = rows(
      [
        ['Employee PF', b.employee_pf],
        ['ESI', b.esi],
        ['LWF', b.lwf],
        ['Meal', b.meal],
        ['Accommodation', b.accommodation],
      ],
      rightX, y + 22,
    );
    ry = totalRow('Total Deduction', b.total_deduction, rightX, ry);

    y = Math.max(ly, ry) + 16;

    // ─── Net pay banner ───
    doc.roundedRect(pageLeft, y, contentW, 40, 6).fill(BRAND);
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#ffffff')
      .text('Net Pay (Gross Earnings - Total Deduction)', pageLeft + 16, y + 14);
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#ffffff')
      .text(inr(b.net_pay), pageRight - 160, y + 12, { width: 144, align: 'right' });
    y += 50;
    doc.fontSize(8).font('Helvetica-Oblique').fillColor(GRAY)
      .text('Net in-hand may vary as per tax applicability.', pageLeft, y);
    y += 22;

    // ─── Cost to Company breakdown ───
    doc.fontSize(10).font('Helvetica-Bold').fillColor(DARK).text('Cost to Company (CTC)', pageLeft, y);
    y += 6;
    doc.moveTo(pageLeft, y + 12).lineTo(pageRight, y + 12).strokeColor(LINE).lineWidth(1).stroke();
    y += 20;

    const ctcRow = (label: string, val: number, indent = false, bold = false) => {
      doc.fontSize(9).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(bold ? DARK : GRAY)
        .text(label, pageLeft + (indent ? 18 : 4), y, { width: contentW - 120 });
      doc.fontSize(9).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(DARK)
        .text(inr(val), pageRight - 120, y, { width: 116, align: 'right' });
      y += 17;
    };

    ctcRow('A + B  Gross Earnings', b.gross_earnings, false, true);
    ctcRow('C. Retirals (Employer Contributions)', b.retirals, false, true);
    ctcRow('Employer PF', b.employer_pf, true);
    ctcRow('Gratuity', b.gratuity, true);
    ctcRow('Employer LWF', b.employer_lwf, true);
    ctcRow('D. Benefits', b.benefits, false, true);
    ctcRow('Employer ESI / Medical Benefit', b.employer_esi, true);
    ctcRow('Accommodation Allowance', b.accommodation_allowance, true);

    y += 4;
    doc.roundedRect(pageLeft, y, contentW, 30, 6).fill('#eef2ff');
    doc.fontSize(11).font('Helvetica-Bold').fillColor(BRAND)
      .text('Total CTC (A + B + C + D)', pageLeft + 16, y + 9);
    doc.fontSize(12).font('Helvetica-Bold').fillColor(BRAND)
      .text(inr(b.ctc), pageRight - 160, y + 8, { width: 144, align: 'right' });

    // ─── Footer ───
    const footerY = doc.page.height - 56;
    doc.fontSize(7.5).font('Helvetica-Oblique').fillColor(GRAY)
      .text('This is a system-generated payslip and does not require a signature.',
        pageLeft, footerY, { width: contentW, align: 'center' });
    doc.fontSize(7).font('Helvetica').fillColor(GRAY)
      .text('SaltStayz Hospitality Pvt. Ltd.  |  Gurugram, India  |  www.saltstayz.com  |  hr@saltstayz.com',
        pageLeft, footerY + 14, { width: contentW, align: 'center' });

    doc.end();
  });
}
