export const certificateElementNames = { name: 'Recipient name', certificateId: 'Certificate ID', qr: 'QR code' };

export default function PlacementControls({ template, element, onSelect, onChange, onReset }) {
  const item = template.layout[element];
  const isQr = element === 'qr';
  const fields = [
    ['x', isQr ? 'Left position' : 'Horizontal center', 0, 100],
    ['y', isQr ? 'Top position' : 'Vertical center', 0, 100],
    ['size', isQr ? 'QR size' : 'Text size', isQr ? 7 : 1, isQr ? 30 : 12],
    ...(isQr ? [] : [['width', 'Text area width', 10, 100]]),
  ];
  return <section className="certificate-placement-editor" aria-labelledby="certificate-placement-title">
    <h3 id="certificate-placement-title">Customize placement</h3>
    <p>Select an element, then drag it on the preview or enter its exact position below.</p>
    <div className="certificate-element-picker" role="group" aria-label="Element to customize">
      {Object.entries(certificateElementNames).map(([key, name]) => <button key={key} type="button" aria-pressed={key === element} onClick={() => onSelect(key)}>{name}</button>)}
    </div>
    <div className="certificate-placement-controls">
      {fields.map(([key, label, min, max]) => <div className="certificate-placement-field" key={`${element}-${key}`}>
        <label htmlFor={`placement-${element}-${key}`}>{label}</label>
        <div className="certificate-placement-value"><input id={`placement-${element}-${key}`} type="number" inputMode="decimal" min={min} max={max} step="0.1" value={Number(item[key].toFixed(1))} onChange={event => {
          if (event.target.value !== '' && Number.isFinite(event.target.valueAsNumber)) onChange({ [key]: Math.min(max, Math.max(min, event.target.valueAsNumber)) });
        }} /><span aria-hidden="true">%</span></div>
        <input aria-label={`${certificateElementNames[element]} ${label.toLowerCase()} slider`} type="range" min={min} max={max} step="0.1" value={item[key]} onChange={event => onChange({ [key]: Number(event.target.value) })} />
      </div>)}
    </div>
    {!isQr && <div className="certificate-text-options"><label>Text color<input type="color" value={item.color} onChange={event => onChange({ color: event.target.value })} /></label><label>Font style<select value={item.font} onChange={event => onChange({ font: event.target.value })}><option value="serif">Serif</option><option value="sans-serif">Sans serif</option></select></label></div>}
    <button type="button" className="secondary-button" onClick={onReset}>Reset placement</button>
  </section>;
}

export function PlacementCanvas({ preview, template, element, onSelect, onMove, dragRef }) {
  return <div className="certificate-preview-position certificate-drag-canvas" onClick={event => {
    if (event.target.tagName !== 'IMG' || event.detail === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    onMove(element, { x: (event.clientX - bounds.left) / bounds.width * 100, y: (event.clientY - bounds.top) / bounds.height * 100 });
  }}>
    <img src={preview} draggable="false" alt="Certificate design with movable recipient name, certificate ID and QR code" />
    {Object.entries(certificateElementNames).map(([key, name]) => {
      const item = template.layout[key];
      const qr = key === 'qr';
      const width = qr ? item.size : item.width;
      const height = qr ? item.size * template.width / template.height : item.size * 2;
      return <button key={key} type="button" className={`certificate-drag-handle ${key === element ? 'is-selected' : ''}`} aria-label={`Move ${name}. Drag or use arrow keys.`} aria-pressed={key === element}
        style={{ left: `${qr ? item.x : item.x - width / 2}%`, top: `${qr ? item.y : item.y - height / 2}%`, width: `${width}%`, height: `${height}%` }}
        onClick={event => { event.stopPropagation(); onSelect(key); }}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); onSelect(key);
          const bounds = event.currentTarget.parentElement.getBoundingClientRect();
          dragRef.current = { key, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: item.x, y: item.y, width: bounds.width, height: bounds.height };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId || drag.key !== key) return;
          onMove(key, { x: drag.x + (event.clientX - drag.startX) / drag.width * 100, y: drag.y + (event.clientY - drag.startY) / drag.height * 100 });
        }}
        onPointerUp={event => { if (dragRef.current?.pointerId === event.pointerId) { dragRef.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }}
        onPointerCancel={() => { dragRef.current = null; }} onLostPointerCapture={() => { dragRef.current = null; }}
        onKeyDown={event => {
          const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
          const delta = directions[event.key];
          if (!delta) return;
          event.preventDefault(); onSelect(key);
          const step = event.shiftKey ? 2 : 0.5;
          onMove(key, { x: item.x + delta[0] * step, y: item.y + delta[1] * step });
        }}><span>{name}</span></button>;
    })}
  </div>;
}
