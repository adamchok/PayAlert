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

interface TransactionLocationMapImplProps {
  tx: Transaction
}

export default function TransactionLocationMapImpl({ tx }: TransactionLocationMapImplProps) {
  useEffect(() => {
    delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: '/leaflet/marker-icon-2x.png',
      iconUrl: '/leaflet/marker-icon.png',
      shadowUrl: '/leaflet/marker-shadow.png',
    })
  }, [])

  const geo = geocodeLocation(tx.merchantCity, tx.merchantCountry)

  if (!geo) {
    return (
      <div className="h-full flex items-center justify-center text-[var(--muted-foreground)] text-sm">
        Location not available
      </div>
    )
  }

  return (
    <MapContainer
      center={[geo.lat, geo.lng]}
      zoom={8}
      scrollWheelZoom={false}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={[geo.lat, geo.lng]} icon={icon}>
        <Popup>
          <strong>{tx.merchantName ?? geo.label}</strong><br />
          {[tx.merchantCity, tx.merchantState, tx.merchantCountry].filter(Boolean).join(', ')}
        </Popup>
      </Marker>
    </MapContainer>
  )
}
