/* eslint-disable react-refresh/only-export-components */
import type { SVGProps } from "react"

import { cn } from "@/lib/utils"

type NucleoIconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  size?: number | string
  strokeWidth?: number | string
}

type NucleoIconDefinition = {
  viewBox: string
  svg: string
}

const iconDefinitions = {
  arrowDown: {
    viewBox: "0 0 20 20",
    svg: '<line x1="10" y1="3" x2="10" y2="17" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" data-color="color-2"></line><polyline points="5 12 10 17 15 12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></polyline>',
  },
  arrowUp: {
    viewBox: "0 0 20 20",
    svg: '<line x1="10" y1="17" x2="10" y2="3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" data-color="color-2"></line><polyline points="15 8 10 3 5 8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></polyline>',
  },
  check: {
    viewBox: "0 0 18 18",
    svg: '<polyline points="2.75 9.25 6.75 14.25 15.25 3.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></polyline>',
  },
  branch: {
    viewBox: "0 0 18 18",
    svg: '<circle cx="5.25" cy="4.75" r="2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></circle><circle cx="12.75" cy="13.25" r="2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></circle><path d="M5.25 6.75v2.25c0 2.347 1.903 4.25 4.25 4.25h1.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path><path d="M8.25 4.75h2.25c1.243 0 2.25 1.007 2.25 2.25v4.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" data-color="color-2"></path>',
  },
  circleAlert: {
    viewBox: "0 0 18 18",
    svg: '<circle cx="9" cy="9" r="6.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></circle><line x1="9" y1="5.5" x2="9" y2="9.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><circle cx="9" cy="12.25" r=".75" fill="currentColor" stroke-width="0"></circle>',
  },
  circleCheck: {
    viewBox: "0 0 18 18",
    svg: '<circle cx="9" cy="9" r="6.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></circle><polyline points="5.75 9.25 8 11.5 12.5 6.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></polyline>',
  },
  clock: {
    viewBox: "0 0 18 18",
    svg: '<circle cx="9" cy="9" r="6.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></circle><polyline points="9 5.5 9 9.25 11.75 10.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></polyline>',
  },
  chevronDown: {
    viewBox: "0 0 18 18",
    svg: '<polyline points="15.25 6.5 9 12.75 2.75 6.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></polyline>',
  },
  chevronRight: {
    viewBox: "0 0 18 18",
    svg: '<polyline points="6.5 2.75 12.75 9 6.5 15.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></polyline>',
  },
  chevronUp: {
    viewBox: "0 0 18 18",
    svg: '<polyline points="2.75 11.5 9 5.25 15.25 11.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></polyline>',
  },
  copy: {
    viewBox: "0 0 20 20",
    svg: '<path d="m13,7h2c1.105,0,2,.895,2,2v6c0,1.105-.895,2-2,2h-6c-1.105,0-2-.895-2-2v-2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" data-color="color-2"></path><rect x="3" y="3" width="10" height="10" rx="2" ry="2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></rect>',
  },
  code: {
    viewBox: "0 0 18 18",
    svg: '<polyline points="6.5 5.25 2.75 9 6.5 12.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></polyline><polyline points="11.5 5.25 15.25 9 11.5 12.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></polyline>',
  },
  database: {
    viewBox: "0 0 18 18",
    svg: '<ellipse cx="9" cy="4.75" rx="5.75" ry="2.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></ellipse><path d="M3.25,4.75v4.25c0,1.381,2.574,2.5,5.75,2.5s5.75-1.119,5.75-2.5V4.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path><path d="M3.25,9v4.25c0,1.381,2.574,2.5,5.75,2.5s5.75-1.119,5.75-2.5V9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path>',
  },
  eye: {
    viewBox: "0 0 18 18",
    svg: '<path d="M1.859,8c1.815-1.851,4.344-3,7.141-3s5.326,1.148,7.141,3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path><circle cx="9" cy="10.5" r="2.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" data-color="color-2"></circle><line x1="4.021" y1="6.328" x2="2.75" y2="4.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><line x1="7.3" y1="5.144" x2="6.823" y2="2.769" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><line x1="13.979" y1="6.328" x2="15.25" y2="4.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><line x1="10.7" y1="5.144" x2="11.177" y2="2.769" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line>',
  },
  eyeOff: {
    viewBox: "0 0 18 18",
    svg: '<path d="M1.859,7.27c1.815,1.851,4.344,3,7.141,3s5.326-1.148,7.141-3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path><line x1="4.021" y1="8.942" x2="2.75" y2="11.019" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><line x1="7.3" y1="10.126" x2="6.823" y2="12.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><line x1="13.979" y1="8.942" x2="15.25" y2="11.019" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><line x1="10.7" y1="10.126" x2="11.177" y2="12.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line>',
  },
  file: {
    viewBox: "0 0 18 18",
    svg: '<path d="M2.75,14.25V3.75c0-1.105,.895-2,2-2h5.586c.265,0,.52,.105,.707,.293l3.914,3.914c.188,.188,.293,.442,.293,.707v7.586c0,1.105-.895,2-2,2H4.75c-1.105,0-2-.895-2-2Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path><path d="M15.16,6.25h-3.41c-.552,0-1-.448-1-1V1.852" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path>',
  },
  fileText: {
    viewBox: "0 0 18 18",
    svg: '<line x1="5.75" y1="6.75" x2="7.75" y2="6.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" data-color="color-2"></line><line x1="5.75" y1="9.75" x2="12.25" y2="9.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" data-color="color-2"></line><line x1="5.75" y1="12.75" x2="12.25" y2="12.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" data-color="color-2"></line><path d="M2.75,14.25V3.75c0-1.105,.895-2,2-2h5.586c.265,0,.52,.105,.707,.293l3.914,3.914c.188,.188,.293,.442,.293,.707v7.586c0,1.105-.895,2-2,2H4.75c-1.105,0-2-.895-2-2Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path><path d="M15.16,6.25h-3.41c-.552,0-1-.448-1-1V1.852" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path>',
  },
  folder: {
    viewBox: "0 0 18 18",
    svg: '<path d="M2.25,8.75V4.75c0-1.105,.895-2,2-2h1.951c.607,0,1.18,.275,1.56,.748l.603,.752h5.386c1.105,0,2,.895,2,2v2.844" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" data-color="color-2"></path><path d="M4.25,6.75H13.75c1.105,0,2,.895,2,2v4.5c0,1.105-.895,2-2,2H4.25c-1.105,0-2-.895-2-2v-4.5c0-1.105,.895-2,2-2Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path>',
  },
  folderOpen: {
    viewBox: "0 0 18 18",
    svg: '<path d="M2.25,7.75v-3c0-1.105,.895-2,2-2h1.951c.607,0,1.18,.275,1.56,.748l.603,.752h5.386c1.105,0,2,.895,2,2v1.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" data-color="color-2"></path><path d="M2.702,7.75H15.298c.986,0,1.703,.934,1.449,1.886l-1.101,4.129c-.233,.876-1.026,1.485-1.932,1.485H4.287c-.906,0-1.699-.609-1.932-1.485l-1.101-4.129c-.254-.952,.464-1.886,1.449-1.886Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path>',
  },
  image: {
    viewBox: "0 0 18 18",
    svg: '<path d="M3.762,14.989l6.074-6.075c.781-.781,2.047-.781,2.828,0l2.586,2.586" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" data-color="color-2"></path><rect x="2.75" y="2.75" width="12.5" height="12.5" rx="2" ry="2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></rect><circle cx="6.25" cy="7.25" r="1.25" fill="currentColor" data-color="color-2" data-stroke="none"></circle>',
  },
  moreHorizontal: {
    viewBox: "0 0 18 18",
    svg: '<circle cx="4.5" cy="9" r="1.1" fill="currentColor"></circle><circle cx="9" cy="9" r="1.1" fill="currentColor"></circle><circle cx="13.5" cy="9" r="1.1" fill="currentColor"></circle>',
  },
  gripVertical: {
    viewBox: "0 0 18 18",
    svg: '<circle cx="7" cy="5" r=".9" fill="currentColor"></circle><circle cx="11" cy="5" r=".9" fill="currentColor"></circle><circle cx="7" cy="9" r=".9" fill="currentColor"></circle><circle cx="11" cy="9" r=".9" fill="currentColor"></circle><circle cx="7" cy="13" r=".9" fill="currentColor"></circle><circle cx="11" cy="13" r=".9" fill="currentColor"></circle>',
  },
  loaderCircle: {
    viewBox: "0 0 18 18",
    svg: '<path d="M15.25,9c0,3.452-2.798,6.25-6.25,6.25s-6.25-2.798-6.25-6.25S5.548,2.75,9,2.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path>',
  },
  panelLeft: {
    viewBox: "0 0 18 18",
    svg: '<rect x="3.25" y="3.25" width="11.5" height="11.5" rx="1.8" ry="1.8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></rect><line x1="8" y1="3.25" x2="8" y2="14.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line>',
  },
  paperclip: {
    viewBox: "0 0 18 18",
    svg: '<path d="M7.75,5v6.75c0,.828,.672,1.5,1.5,1.5h0c.828,0,1.5-.672,1.5-1.5V4.75c0-1.657-1.343-3-3-3h0c-1.657,0-3,1.343-3,3v7c0,2.485,2.015,4.5,4.5,4.5h0c2.485,0,4.5-2.015,4.5-4.5V5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path>',
  },
  pencil: {
    viewBox: "0 0 18 18",
    svg: '<path d="M3.25,12.75l-.75,2.75,2.75-.75,8.657-8.657c.781-.781,.781-2.047,0-2.828l-.172-.172c-.781-.781-2.047-.781-2.828,0L3.25,12.75Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path><line x1="10.25" y1="3.75" x2="13.25" y2="6.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line>',
  },
  plus: {
    viewBox: "0 0 18 18",
    svg: '<line x1="9" y1="3.25" x2="9" y2="14.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" data-color="color-2"></line><line x1="3.25" y1="9" x2="14.75" y2="9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line>',
  },
  settings: {
    viewBox: "0 0 18 18",
    svg: '<line x1="6.25" y1="4.237" x2="9" y2="9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" data-color="color-2"></line><line x1="6.25" y1="13.764" x2="9" y2="9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" data-color="color-2"></line><line x1="14.5" y1="9" x2="9" y2="9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" data-color="color-2"></line><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></circle><line x1="9" y1="1.75" x2="9" y2="3.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><line x1="2.721" y1="5.375" x2="4.237" y2="6.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><line x1="1.75" y1="9" x2="3.5" y2="9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><line x1="16.25" y1="9" x2="14.5" y2="9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><line x1="2.721" y1="12.625" x2="4.237" y2="11.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><line x1="9" y1="16.25" x2="9" y2="14.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><line x1="12.625" y1="15.279" x2="11.75" y2="13.763" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><line x1="5.375" y1="15.279" x2="6.25" y2="13.763" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><line x1="15.279" y1="12.625" x2="13.763" y2="11.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><line x1="15.279" y1="5.375" x2="13.763" y2="6.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><line x1="12.625" y1="2.721" x2="11.75" y2="4.237" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><line x1="5.375" y1="2.721" x2="6.25" y2="4.237" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line>',
  },
  search: {
    viewBox: "0 0 18 18",
    svg: '<circle cx="7.75" cy="7.75" r="5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></circle><line x1="11.286" y1="11.286" x2="15.25" y2="15.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line>',
  },
  sendHorizontal: {
    viewBox: "0 0 18 18",
    svg: '<path d="M2.75,9h10.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path><path d="M9.5,4.75l4.25,4.25-4.25,4.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path>',
  },
  slidersHorizontal: {
    viewBox: "0 0 18 18",
    svg: '<line x1="2.75" y1="5" x2="6.25" y2="5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><line x1="11.75" y1="5" x2="15.25" y2="5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><circle cx="9" cy="5" r="2.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" data-color="color-2"></circle><line x1="2.75" y1="13" x2="10.25" y2="13" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><line x1="15.25" y1="13" x2="15.25" y2="13" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line><circle cx="12.5" cy="13" r="2.25" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" data-color="color-2"></circle>',
  },
  sparkles: {
    viewBox: "0 0 18 18",
    svg: '<path d="M8.5,2.75l1.22,3.03,3.03,1.22-3.03,1.22-1.22,3.03-1.22-3.03-3.03-1.22,3.03-1.22,1.22-3.03Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path><path d="M13.5,10.75l.62,1.38,1.38,.62-1.38,.62-.62,1.38-.62-1.38-1.38-.62,1.38-.62,.62-1.38Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path>',
  },
  squareTerminal: {
    viewBox: "0 0 18 18",
    svg: '<rect x="2.75" y="3.25" width="12.5" height="11.5" rx="2" ry="2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></rect><path d="M6 7.25L8.25 9L6 10.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path><line x1="9.75" y1="10.75" x2="12.25" y2="10.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line>',
  },
  trash: {
    viewBox: "0 0 18 18",
    svg: '<path d="M13.6977 7.75L13.35 14.35C13.294 15.4201 12.416 16.25 11.353 16.25H6.64804C5.58404 16.25 4.70703 15.42 4.65103 14.35L4.30334 7.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"></path><path d="M2.75 4.75H15.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" data-color="color-2" fill="none"></path><path d="M6.75 4.75V2.75C6.75 2.2 7.198 1.75 7.75 1.75H10.25C10.802 1.75 11.25 2.2 11.25 2.75V4.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" data-color="color-2" fill="none"></path>',
  },
  x: {
    viewBox: "0 0 18 18",
    svg: '<line x1="14" y1="4" x2="4" y2="14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" data-color="color-2"></line><line x1="4" y1="4" x2="14" y2="14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></line>',
  },
} satisfies Record<string, NucleoIconDefinition>

function createNucleoIcon(icon: NucleoIconDefinition) {
  return function NucleoIcon({
    className,
    size = 18,
    strokeWidth,
    style,
    ...props
  }: NucleoIconProps) {
    void strokeWidth
    return (
      <svg
        aria-hidden="true"
        className={cn("inline-block shrink-0", className)}
        dangerouslySetInnerHTML={{ __html: icon.svg }}
        fill="none"
        height={size}
        role="img"
        style={{ color: "currentColor", ...style }}
        viewBox={icon.viewBox}
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      />
    )
  }
}

export const ArrowDown = createNucleoIcon(iconDefinitions.arrowDown)
export const ArrowUp = createNucleoIcon(iconDefinitions.arrowUp)
export const Branch = createNucleoIcon(iconDefinitions.branch)
export const Check = createNucleoIcon(iconDefinitions.check)
export const ChevronDown = createNucleoIcon(iconDefinitions.chevronDown)
export const ChevronRight = createNucleoIcon(iconDefinitions.chevronRight)
export const ChevronUp = createNucleoIcon(iconDefinitions.chevronUp)
export const CircleAlert = createNucleoIcon(iconDefinitions.circleAlert)
export const CircleCheck = createNucleoIcon(iconDefinitions.circleCheck)
export const Clock = createNucleoIcon(iconDefinitions.clock)
export const Code = createNucleoIcon(iconDefinitions.code)
export const Copy = createNucleoIcon(iconDefinitions.copy)
export const Database = createNucleoIcon(iconDefinitions.database)
export const Eye = createNucleoIcon(iconDefinitions.eye)
export const EyeOff = createNucleoIcon(iconDefinitions.eyeOff)
export const File = createNucleoIcon(iconDefinitions.file)
export const FileImage = createNucleoIcon(iconDefinitions.image)
export const FileText = createNucleoIcon(iconDefinitions.fileText)
export const Folder = createNucleoIcon(iconDefinitions.folder)
export const FolderOpen = createNucleoIcon(iconDefinitions.folderOpen)
export const GripVertical = createNucleoIcon(iconDefinitions.gripVertical)
export const LoaderCircle = createNucleoIcon(iconDefinitions.loaderCircle)
export const MoreHorizontal = createNucleoIcon(iconDefinitions.moreHorizontal)
export const PanelLeft = createNucleoIcon(iconDefinitions.panelLeft)
export const Paperclip = createNucleoIcon(iconDefinitions.paperclip)
export const Pencil = createNucleoIcon(iconDefinitions.pencil)
export const Plus = createNucleoIcon(iconDefinitions.plus)
export const Search = createNucleoIcon(iconDefinitions.search)
export const SendHorizontal = createNucleoIcon(iconDefinitions.sendHorizontal)
export const Settings = createNucleoIcon(iconDefinitions.settings)
export const SlidersHorizontal = createNucleoIcon(iconDefinitions.slidersHorizontal)
export const Sparkles = createNucleoIcon(iconDefinitions.sparkles)
export const SquareTerminal = createNucleoIcon(iconDefinitions.squareTerminal)
export const Terminal = SquareTerminal
export const Trash2 = createNucleoIcon(iconDefinitions.trash)
export const X = createNucleoIcon(iconDefinitions.x)
