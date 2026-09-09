export default function Gamecard({ title, description }) {
  return (
    <div className="gamecard">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}