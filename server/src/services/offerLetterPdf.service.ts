import PDFDocument from 'pdfkit';
import { legacyBreakdownToLines, type PayslipBreakdown } from './payslip.calc';

interface OfferLetterData {
  candidateName: string;
  designation: string;
  salary: string;
  joiningDate: string;
  employeeCode: string;
  generatedBy: string;
  generatedDate: string;
  salaryBreakdown?: PayslipBreakdown;
}

/**
 * The Compensation Structure rows for the offer letter, ITEMISED per component so
 * every salary component edited in the offer editor (earnings, deductions, employer
 * benefits, reimbursements) shows up as its own line — not just an aggregate.
 * Returns `[label, amount, isBold?]`.
 */
export function buildCompensationRows(breakdown: PayslipBreakdown): [string, number, boolean?][] {
  const b = legacyBreakdownToLines(breakdown);
  const nonZero = (pairs: [string, number][]): [string, number][] => pairs.filter(([, v]) => Number(v) > 0);
  const named = (arr: any[] | undefined): [string, number][] => (arr ?? []).map((l: any) => [l.name, l.amount]);
  return [
    ...named(b.earnings),
    ['Gross Earnings', b.gross_earnings, true],
    ...nonZero([['Provident Fund', b.employee_pf], ['ESI', b.esi], ['Professional Tax', b.pt], ['Labour Welfare Fund', b.lwf]]),
    ...named(b.other_deductions),
    ['Total Deductions', b.total_deduction, true],
    ['Net In-Hand (approx.)', b.net_pay, true],
    ...nonZero([['Employer PF', b.employer_pf], ['Employer ESI', b.employer_esi], ['Employer LWF', b.employer_lwf]]),
    ...named(b.employer_costs),
    ...named(b.reimbursements),
    ['Cost to Company (CTC)', b.ctc, true],
  ];
}

export function generateOfferLetterPdf(data: OfferLetterData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 60 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - 120;
    const brandColor = '#2563eb';
    const darkColor = '#111827';
    const grayColor = '#6b7280';
    const lightGray = '#f3f4f6';

    // ─── Header Bar ───
    doc.rect(0, 0, doc.page.width, 100).fill(brandColor);

    doc.fontSize(28).font('Helvetica-Bold').fillColor('#ffffff')
      .text('SaltStayz', 60, 28);
    doc.fontSize(10).font('Helvetica').fillColor('#dbeafe')
      .text('HOSPITALITY PVT. LTD.', 60, 60);

    doc.fontSize(9).fillColor('#dbeafe')
      .text('OFFER OF EMPLOYMENT', doc.page.width - 200, 42, { width: 140, align: 'right' });

    // ─── Date ───
    doc.moveDown(2);
    doc.y = 120;
    doc.fontSize(9).font('Helvetica').fillColor(grayColor)
      .text(`Date: ${data.generatedDate}`, 60);

    doc.fontSize(9).fillColor(grayColor)
      .text(`Ref: SALT/OL/${data.employeeCode}/${new Date().getFullYear()}`, 60);

    // ─── Salutation ───
    doc.moveDown(1.5);
    doc.fontSize(11).font('Helvetica').fillColor(darkColor)
      .text(`Dear ${data.candidateName},`, 60);

    // ─── Body Paragraph 1 ───
    doc.moveDown(0.8);
    doc.fontSize(10).font('Helvetica').fillColor(darkColor)
      .text(
        `We are delighted to extend this offer of employment to you for the position of ${data.designation} at SaltStayz Hospitality Pvt. Ltd. Your skills, experience, and enthusiasm stood out during our selection process, and we are confident you will make a significant contribution to our team.`,
        60, undefined, { width: pageWidth, lineGap: 4 }
      );

    // ─── Details Box ───
    doc.moveDown(1.2);
    const boxY = doc.y;
    const boxHeight = 120;
    doc.roundedRect(60, boxY, pageWidth, boxHeight, 6).fill(lightGray);

    doc.fontSize(10).font('Helvetica-Bold').fillColor(brandColor)
      .text('EMPLOYMENT DETAILS', 80, boxY + 14);

    const detailY = boxY + 36;
    const col1 = 80;
    const col2 = 280;

    doc.fontSize(9).font('Helvetica').fillColor(grayColor).text('Position', col1, detailY);
    doc.font('Helvetica-Bold').fillColor(darkColor).text(data.designation, col1, detailY + 14);

    doc.font('Helvetica').fillColor(grayColor).text('Annual CTC', col2, detailY);
    doc.font('Helvetica-Bold').fillColor(darkColor).text(`₹ ${data.salary}`, col2, detailY + 14);

    doc.font('Helvetica').fillColor(grayColor).text('Date of Joining', col1, detailY + 38);
    doc.font('Helvetica-Bold').fillColor(darkColor).text(data.joiningDate, col1, detailY + 52);

    doc.font('Helvetica').fillColor(grayColor).text('Employee Code', col2, detailY + 38);
    doc.font('Helvetica-Bold').fillColor(darkColor).text(data.employeeCode, col2, detailY + 52);

    // ─── Compensation Structure (from the designation's salary structure) ───
    doc.y = boxY + boxHeight + 18;
    if (data.salaryBreakdown) {
      const inr = (n: number) => 'INR ' + Math.round(n).toLocaleString('en-IN');
      doc.fontSize(10).font('Helvetica-Bold').fillColor(darkColor).text('Compensation Structure (Monthly)', 60);
      doc.moveDown(0.4);
      const rows = buildCompensationRows(data.salaryBreakdown);
      let y = doc.y;
      for (const [label, val, bold] of rows) {
        if (y > doc.page.height - 110) { doc.addPage(); y = 60; } // longer structures flow onto a new page
        doc.fontSize(9).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(bold ? brandColor : darkColor)
          .text(label, 70, y, { width: pageWidth - 160 });
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(bold ? brandColor : darkColor)
          .text(inr(val), 60, y, { width: pageWidth, align: 'right' });
        y += 15;
      }
      doc.fontSize(7.5).font('Helvetica-Oblique').fillColor(grayColor)
        .text('Net in-hand may vary as per tax applicability.', 70, y + 2);
      doc.y = y + 16;
    }

    // ─── Terms ───
    doc.fontSize(10).font('Helvetica-Bold').fillColor(darkColor)
      .text('Terms & Conditions', 60);

    doc.moveDown(0.5);
    const terms = [
      'This offer is subject to successful verification of your educational qualifications, employment history, and background checks.',
      'You are required to serve a probationary period of six (6) months from the date of joining, during which your performance will be evaluated.',
      'The detailed compensation structure, including allowances, deductions, and benefits, will be shared in your appointment letter upon joining.',
      'You are expected to adhere to the company\'s policies, code of conduct, and applicable rules as communicated during your induction.',
      'This offer is valid for 15 days from the date of issuance. Kindly confirm your acceptance within this period.',
    ];

    terms.forEach((term, i) => {
      doc.fontSize(9).font('Helvetica').fillColor(darkColor)
        .text(`${i + 1}. ${term}`, 60, undefined, { width: pageWidth, lineGap: 2 });
      doc.moveDown(0.3);
    });

    // ─── Acceptance ───
    doc.moveDown(0.8);
    doc.fontSize(10).font('Helvetica').fillColor(darkColor)
      .text(
        'We are excited to welcome you to the SaltStayz family and look forward to a rewarding journey together. Please confirm your acceptance by signing and returning a copy of this letter.',
        60, undefined, { width: pageWidth, lineGap: 4 }
      );

    // ─── Signature Area ───
    doc.moveDown(2);
    doc.fontSize(10).font('Helvetica').fillColor(darkColor)
      .text('Warm regards,', 60);
    doc.moveDown(2.5);
    doc.moveTo(60, doc.y).lineTo(220, doc.y).strokeColor(grayColor).lineWidth(0.5).stroke();
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(darkColor)
      .text('Authorized Signatory', 60);
    doc.fontSize(9).font('Helvetica').fillColor(grayColor)
      .text('Human Resources Department', 60);
    doc.text('SaltStayz Hospitality Pvt. Ltd.', 60);

    // ─── Candidate Acceptance ───
    doc.moveDown(2);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(darkColor)
      .text('ACCEPTANCE', 60);
    doc.moveDown(0.5);
    doc.fontSize(9).font('Helvetica').fillColor(darkColor)
      .text('I accept the terms and conditions of this offer of employment.', 60, undefined, { width: pageWidth });
    doc.moveDown(2);

    const sigY = doc.y;
    doc.moveTo(60, sigY).lineTo(220, sigY).strokeColor(grayColor).lineWidth(0.5).stroke();
    doc.moveTo(300, sigY).lineTo(460, sigY).strokeColor(grayColor).lineWidth(0.5).stroke();
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica').fillColor(grayColor)
      .text('Signature', 60);
    doc.text('Date', 300, doc.y - 12);

    // ─── Footer ───
    const footerY = doc.page.height - 40;
    doc.rect(0, footerY - 10, doc.page.width, 50).fill(brandColor);
    doc.fontSize(7).font('Helvetica').fillColor('#dbeafe')
      .text(
        'SaltStayz Hospitality Pvt. Ltd. | New Delhi, India | www.saltstayz.com | hr@saltstayz.com',
        0, footerY, { width: doc.page.width, align: 'center' }
      );

    doc.end();
  });
}
