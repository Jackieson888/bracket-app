import { MongoClient } from "mongodb";
import { getRequiredEnvVar } from "./runtime-config";

const options = {};

let client: MongoClient | undefined;
let clientPromise: Promise<MongoClient> | undefined;

function getMongoClientPromise(): Promise<MongoClient> {
  if (!clientPromise) {
    const uri = getRequiredEnvVar("MONGODB_URI");

    if (process.env.NODE_ENV === "development") {
      if (
        !(
          global as typeof globalThis & {
            _mongoClientPromise?: Promise<MongoClient>;
          }
        )._mongoClientPromise
      ) {
        client = new MongoClient(uri, options);
        (
          global as typeof globalThis & {
            _mongoClientPromise?: Promise<MongoClient>;
          }
        )._mongoClientPromise = client.connect();
      }
      clientPromise = (
        global as typeof globalThis & {
          _mongoClientPromise?: Promise<MongoClient>;
        }
      )._mongoClientPromise;
    } else {
      client = new MongoClient(uri, options);
      clientPromise = client.connect();
    }
  }

  return clientPromise!;
}

export default getMongoClientPromise();
