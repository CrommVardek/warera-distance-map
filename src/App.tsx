import BaseMap from './Map'
import AccountPanel from './account/AccountPanel'
import './App.css'
import 'maplibre-gl/dist/maplibre-gl.css';
import {setWorkerUrl} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);

function App() {
  return (
    <>
      <div id="map-container">
        <BaseMap />
      </div>
      {/* app chrome rather than map chrome, so it sits outside BaseMap */}
      <AccountPanel />
    </>
  )
}

export default App
