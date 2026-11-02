import type { SVGProps } from "react";

export function AppMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="2 2 20 20" xmlns="http://www.w3.org/2000/svg">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M5.5 3H18.5A3.5 3.5 0 0 1 22 6.5V17.5A3.5 3.5 0 0 1 18.5 21H5.5A3.5 3.5 0 0 1 2 17.5V6.5A3.5 3.5 0 0 1 5.5 3ZM5.75 8H18.25A2 2 0 0 1 20.25 10V17.25A2 2 0 0 1 18.25 19.25H5.75A2 2 0 0 1 3.75 17.25V10A2 2 0 0 1 5.75 8ZM6.32 11.49L8.52 13.5L6.32 15.51L7.68 16.99L11.48 13.5L7.68 10.01ZM12.5 15H17V17H12.5Z"
      />
    </svg>
  );
}
