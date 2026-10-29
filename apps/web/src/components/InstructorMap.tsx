"use client";
import { CircleMarker as LeafletCircleMarker, MapContainer as LeafletMapContainer, Popup, TileLayer as LeafletTileLayer } from "react-leaflet";
const CircleMarker: any = LeafletCircleMarker; const MapContainer: any = LeafletMapContainer; const TileLayer: any = LeafletTileLayer;
type Item={user_id:string;full_name:string;city:string;hourly_rate:number;latitude?:number;longitude?:number};
const city:Record<string,[number,number]>={johannesburg:[-26.2041,28.0473],pretoria:[-25.7479,28.2293],durban:[-29.8587,31.0218],"cape town":[-33.9249,18.4241],bloemfontein:[-29.0852,26.1596],gqeberha:[-33.9608,25.6022],polokwane:[-23.9045,29.4689],"east london":[-33.0153,27.9116],nelspruit:[-25.4753,30.9694]};
function coords(i:Item):[number,number]{if(Number.isFinite(i.latitude)&&Number.isFinite(i.longitude))return[Number(i.latitude),Number(i.longitude)];const key=Object.keys(city).find(k=>(i.city??"").toLowerCase().includes(k));return city[key??"johannesburg"];}
export function InstructorMap({items,onSelect}:{items:Item[];onSelect:(item:Item)=>void}){return <MapContainer center={[-29.1,24.4] as [number,number]} zoom={5} scrollWheelZoom className="instructor-leaflet"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>{items.map(i=>{const p=coords(i);return <CircleMarker key={i.user_id} center={p} radius={9} pathOptions={{color:"#fff",weight:3,fillColor:"#c18a4d",fillOpacity:.95}} eventHandlers={{click:()=>onSelect(i)}}><Popup><b>{i.full_name}</b><br/>{i.city}<br/>R{Number(i.hourly_rate).toFixed(0)} / hour<button type="button" onClick={()=>onSelect(i)}>View profile</button></Popup></CircleMarker>})}</MapContainer>}


