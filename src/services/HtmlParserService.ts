import { compile } from 'html-to-text';

export class HtmlParserService {
  private static parse = compile({
    wordwrap: 130,
    selectors: [
      { selector: 'a', options: { ignoreHref: false } },
      { selector: 'img', format: 'skip' },
      { selector: 'table', format: 'dataTable' }
    ]
  });

  public static parseHtml(html: string): string {
    if (!html) return '';
    const text = this.parse(html);
    return text.trim();
  }
}
