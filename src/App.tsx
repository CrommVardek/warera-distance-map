import BaseMap from './Map'
import './App.css'
import 'maplibre-gl/dist/maplibre-gl.css';
import {setWorkerUrl} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);

function App() {
  return (
    <div id="map-container">
      <BaseMap />
    </div>
  )
}

export default App
