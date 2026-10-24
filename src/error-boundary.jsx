import React from 'react';
import { t } from './i18n/index.js';

// Viimane kaitsekiht: kui mõni vaade või laaditud tükk viskab renderdamisel vea,
// jääb rakendus tervikuna kasutatavaks ja pakub uuesti proovimist.
export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error('Soojus: vaate viga', error, info?.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="fatal-error" role="alert">
      <div className="fatal-error-card">
        <h1>{t('errorBoundary.title')}</h1>
        <p>{t('errorBoundary.body')}</p>
        <pre>{String(this.state.error?.message || this.state.error)}</pre>
        <div className="button-row">
          <button type="button" className="button primary" onClick={() => location.reload()}>{t('errorBoundary.reload')}</button>
          <button type="button" className="button" onClick={() => this.setState({ error: null })}>{t('errorBoundary.retry')}</button>
        </div>
      </div>
    </div>;
  }
}
