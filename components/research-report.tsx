import type { ResearchReport as Report } from '@/lib/report';

export function ResearchReport({ report, idPrefix = 'report-section' }: { report: Report; idPrefix?: string }) {
  return <article className="research-document"><header><h1>{report.title}</h1><p className="muted">{report.subtitle}</p></header><nav aria-label="报告目录">{report.sections.map((s,i)=><a key={s.title} href={`#${idPrefix}-${i}`}>{s.title}</a>)}</nav>{report.sections.map((s,i)=><section id={`${idPrefix}-${i}`} key={s.title}><h2>{s.title}</h2>{s.ordered ? <ol>{s.paragraphs.map((p,j)=><li key={j}>{p}</li>)}</ol> : s.paragraphs.map((p,j)=><p key={j}>{p}</p>)}</section>)}</article>;
}
