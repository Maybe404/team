# [team 二开] 公开文档
from django.urls import path

from plane.space.views.team_page import TeamPublicPageAssetEndpoint, TeamPublicPageEndpoint

urlpatterns = [
    path("team-pages/<str:share>/", TeamPublicPageEndpoint.as_view(), name="team-public-page"),
    path("team-pages/<str:share>/assets/<uuid:asset_id>/", TeamPublicPageAssetEndpoint.as_view(), name="team-public-page-asset"),
]
