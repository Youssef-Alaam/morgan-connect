import type { ReactNode } from 'react';

interface TableProps {
  caption: string;
  columns: string[];
  // Each row has a stable key (an id), so rows keep their place when the list changes.
  rows: { key: string; cells: ReactNode[] }[];
}

export function Table({ caption, columns, rows }: TableProps) {
  return (
    <table className="table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ key, cells }) => (
          <tr key={key}>
            {cells.map((cell, column) => (
              <td key={columns[column]}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
