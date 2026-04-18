import { useState } from 'react';
import { Counter } from './Counter';

export function App() {
  const [name, setName] = useState('world');

  return (
    <div>
      <h1>Hello, {name}</h1>
      <p>
        <label>
          Your name:{' '}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </p>
      <Counter />
      <p style={{ marginTop: '2rem', color: '#666', fontSize: '0.875rem' }}>
        This page was compiled in your browser from <code>.tsx</code> files
        served statically. No build step, no bundler ran ahead of time.
      </p>
    </div>
  );
}
