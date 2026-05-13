'use client'

import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { geocodeLocation } from '@/lib/geocoding'
import type { Transaction } from '@/lib/types'

const icon = L.icon({
  iconUrl: '/leaflet/marker-icon.png',
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  shadowUrl: '/leaflet/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
})

interface AccountGeoMapImplProps {
  items: Transaction[]
}

export default function AccountGeoMapImpl({ items }: AccountGeoMapImplProps) {
  useEffect(() => {
    // Fix Leaflet default icon issue in Next.js
    delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: '/leaflet/marker-icon-2x.png',
      iconUrl: '/leaflet/marker-icon.png',
      shadowUrl: '/leaflet/marker-shadow.png',
    })
  }, [])

  // Aggregate by city+country
  const locMap = new Map<string, { lat: number; lng: number; label: string; count: number }>()
  for (const tx of items) {
    const geo = geocodeLocation(tx.merchantCity, tx.merchantCountry)
    if (!geo) continue
    const key = `${geo.lat},${geo.lng}`
    const existing = locMap.get(key)
    if (existing) {
      existing.count++
    } else {
      locMap.set(key, { ...geo, count: 1 })
    }
  }

  const markers = Array.from(locMap.values())

  if (markers.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-[var(--muted-foreground)] text-sm">
        No geocodable locations found
      </div>
    )
  }

  const center: [number, number] = [markers[0].lat, markers[0].lng]

  return (
    <MapContainer
      center={center}
      zoom={5}
      scrollWheelZoom={false}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {markers.map((m) => (
        <Marker key={`${m.lat},${m.lng}`} position={[m.lat, m.lng]} icon={icon}>
          <Popup>
            <strong>{m.label}</strong><br />
            {m.count} transaction{m.count !== 1 ? 's' : ''}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
