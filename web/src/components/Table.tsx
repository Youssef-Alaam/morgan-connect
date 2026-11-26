import type { ReactNode } from 'react';

interface TableProps {
  caption: string;
  columns: string[];
  rows: ReactNode[][];
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
        {rows.map((cells, row) => (
          <tr key={row}>
            {cells.map((cell, column) => (
              <td key={columns[column]}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
