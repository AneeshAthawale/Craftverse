import React from 'react';
import { Link } from 'react-router-dom';

export default function Notfound() {
  return (
    <div className="notfound-page">
      <h1>404</h1>
      <p>Page not found.</p>
      <Link to="/">Go Home</Link>
    </div>
  );
}