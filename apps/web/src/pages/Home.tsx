import { t } from '../glossary';

export function Home({ name }: { name: string }) {
  return (
    <section className="page">
      <h1 className="greeting">{t('greeting', { name })}</h1>
    </section>
  );
}
