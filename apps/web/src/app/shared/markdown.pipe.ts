import { Pipe, type PipeTransform } from '@angular/core';
import { marked } from 'marked';

/**
 * Converte Markdown (testi legali gestiti dagli admin) in HTML.
 * L'output passa da [innerHTML], quindi viene comunque sanificato da Angular.
 */
@Pipe({ name: 'markdown' })
export class MarkdownPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return value ? (marked.parse(value, { async: false, gfm: true }) as string) : '';
  }
}
