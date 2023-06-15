# sjifh
Helper scripts for the San Juan Islands Food Hub


# Orcas Co-Op Provisions



shopify app integration: https://provisions-co-op-wholesale.myshopify.com/admin/settings/apps/development/30398873601/overview


setup secrets

## Docker
`docker build -t sjifh .`
`docker run --env-file .env sjifh bin/shopify_lfm_balancer.js products > products.json`


```sh
gcloud auth configure-docker
docker build -t gcr.io/sjifh-378705/sjifh .
docker push gcr.io/sjifh-378705/sjifh

set -o allexport
source .env
set +o allexport
```
