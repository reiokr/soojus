import React from 'react';
import { Activity, LoaderCircle } from 'lucide-react';
import { number, time } from './lib.js';

export function Badge({ children, tone = 'green' }) { return <span className={`badge ${tone}`}><i />{children}</span>; }
export function Empty({ icon: Icon = Activity, title, children, action }) { return <div className="empty"><span className="empty-icon"><Icon size={25}/></span><h3>{title}</h3><p>{children}</p>{action}</div>; }
export function PanelTitle({ title, subtitle, action }) { return <div className="panel-title"><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{action}</div>; }
export function Button({ children, icon: Icon, kind = 'secondary', busy, ...props }) { return <button type="button" className={`button ${kind}`} {...props} disabled={props.disabled || busy}>{busy ? <LoaderCircle size={16} className="spin"/> : Icon && <Icon size={16}/>} {children}</button>; }

export function Reading({ point }) { return <div className="reading"><span>{point.label}</span><b>{point.enumValues?.length || typeof point.value === 'string' && !Number.isFinite(Number(point.value)) ? point.display : <>{number(point.value,2)} <small>{point.parameterUnit}</small></>}</b><small>{time(point.timestamp)}</small></div>; }
