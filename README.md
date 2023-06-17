# sjifh
Helper scripts for the San Juan Islands Food Hub


# Orcas Co-Op Provisions



shopify app integration: https://provisions-co-op-wholesale.myshopify.com/admin/settings/apps/development/30398873601/overview


setup secrets
gcloud auth application-default login

gcloud auth application-default login


## Docker
`docker build -t sjifh .`
`docker run --env-file .env sjifh bin/shopify_lfm_balancer.js products > products.json`


```sh
Cloud Datastore User
Cloud Functions Service Agent
Cloud Pub/Sub Service Agent
Storage Object Admin
```


```sh
gcloud auth configure-docker
docker build -t gcr.io/sjifh-378705/sjifh .
docker push gcr.io/sjifh-378705/sjifh

set -o allexport
source .env
set +o allexport
```


### Improvements

* taxable: how do we find this info on a per product basis?
